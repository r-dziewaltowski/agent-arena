"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { debateParticipants, debates, reports, turns, user } from "@/lib/db/schema";
import { deleteAgent, deleteDebate, LifecycleError } from "@/lib/debate/lifecycle";
import { sendEmail } from "@/lib/email/send";
import { reportReceived } from "@/lib/email/templates";
import {
  createReport,
  dismissReport,
  removeAgentPicture,
  removeTurnText,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_REASONS,
  ReportError,
  resolveAgentReports,
  type ReportReason,
} from "@/lib/reports";

export type ReportFormState = { sent?: boolean; message?: string };

const reportSchema = z.object({
  debateId: z.string().min(1),
  /** "topic", "turn:<id>" or "agent:<participant id>". */
  about: z.string().regex(/^(topic|turn:.+|agent:.+)$/, "Pick what you're reporting."),
  reason: z.enum(Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]], { error: "Pick a reason." }),
  note: z.string().max(REPORT_NOTE_MAX_LENGTH, `Keep the note under ${REPORT_NOTE_MAX_LENGTH} characters.`).optional(),
});

/** Sends a report from the debate page's Report form, and tells the admins by email. */
export async function reportAction(_prev: ReportFormState, formData: FormData): Promise<ReportFormState> {
  const me = await requireUser();
  const parsed = reportSchema.safeParse({
    debateId: formData.get("debateId"),
    about: formData.get("about"),
    reason: formData.get("reason"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { debateId, about, reason, note } = parsed.data;
  const [target, targetId] = about.includes(":") ? (about.split(/:(.+)/) as ["turn" | "agent", string]) : ["topic" as const, null];

  const db = await getDb();
  try {
    await createReport(db, { debateId, target, targetId, reason, note, reporterId: me.id }, Date.now());
  } catch (err) {
    if (err instanceof ReportError) return { message: err.message };
    throw err;
  }

  // Tell the admins. A failed email is logged, never shown: the report is saved either way.
  try {
    await notifyAdmins(debateId, target, targetId, reason, note ?? null, me.displayName);
  } catch (err) {
    console.error("[reports] couldn't email the admins", err);
  }
  return { sent: true };
}

async function notifyAdmins(debateId: string, target: string, targetId: string | null, reason: ReportReason, note: string | null, reporterName: string) {
  const db = await getDb();
  const admins = await db
    .select({ email: user.email })
    .from(user)
    .where(and(eq(user.isAdmin, true), isNull(user.deletedAt)));
  if (admins.length === 0) return;
  const [debate] = await db.select({ topic: debates.topic }).from(debates).where(eq(debates.id, debateId));
  let what = "the topic";
  if (target === "turn" && targetId) {
    const [turn] = await db
      .select({ seq: turns.seq, name: debateParticipants.name })
      .from(turns)
      .leftJoin(debateParticipants, eq(debateParticipants.id, turns.participantId))
      .where(eq(turns.id, targetId));
    what = turn ? `turn ${turn.seq} (by ${turn.name ?? "an agent"})` : "a turn";
  } else if (target === "agent" && targetId) {
    const [entry] = await db.select({ name: debateParticipants.name }).from(debateParticipants).where(eq(debateParticipants.id, targetId));
    what = `the agent ${entry?.name ?? ""}`.trim();
  }
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  for (const admin of admins) {
    await sendEmail(
      reportReceived(admin.email, { topic: debate?.topic ?? "", what, reason: REPORT_REASONS[reason], note, reporterName }, `${origin}/admin/reports`),
    );
  }
}

/** Admins only: everything below acts on a report from the Reports page. */
async function requireAdmin() {
  const me = await requireUser("/admin/reports");
  if (!me.isAdmin) notFound();
  return me;
}

async function reportOf(formData: FormData) {
  const db = await getDb();
  const [report] = await db.select().from(reports).where(eq(reports.id, String(formData.get("reportId") ?? "")));
  return { db, report };
}

export async function dismissReportAction(formData: FormData) {
  const me = await requireAdmin();
  const { db, report } = await reportOf(formData);
  if (report) await dismissReport(db, report.id, me.id, Date.now());
  refresh();
}

export async function removeTurnAction(formData: FormData) {
  const me = await requireAdmin();
  const { db, report } = await reportOf(formData);
  if (report?.turnId) await removeTurnText(db, report.turnId, me.id, Date.now());
  refresh();
}

export async function removePictureAction(formData: FormData) {
  const me = await requireAdmin();
  const { db, report } = await reportOf(formData);
  const agentId = report?.participantId ? await agentOfEntry(report.participantId) : null;
  if (agentId) await removeAgentPicture(db, agentId, me.id, Date.now());
  refresh();
}

export async function deleteReportedAgentAction(formData: FormData) {
  const me = await requireAdmin();
  const { db, report } = await reportOf(formData);
  const agentId = report?.participantId ? await agentOfEntry(report.participantId) : null;
  if (!agentId) return refresh();
  await resolveAgentReports(db, agentId, me.id, Date.now());
  try {
    await deleteAgent(db, { agentId, userId: me.id, isAdmin: true });
  } catch (err) {
    if (!(err instanceof LifecycleError)) throw err;
  }
  refresh();
}

/** Deleting the debate removes its reports with it. */
export async function deleteReportedDebateAction(formData: FormData) {
  const me = await requireAdmin();
  const { db, report } = await reportOf(formData);
  if (report) {
    try {
      await deleteDebate(db, { debateId: report.debateId, userId: me.id, isAdmin: true });
    } catch (err) {
      if (!(err instanceof LifecycleError)) throw err;
    }
  }
  refresh();
}

async function agentOfEntry(participantId: string): Promise<string | null> {
  const db = await getDb();
  const [entry] = await db.select({ agentId: debateParticipants.agentId }).from(debateParticipants).where(eq(debateParticipants.id, participantId));
  return entry?.agentId ?? null;
}
