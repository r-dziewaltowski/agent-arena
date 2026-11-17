import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { connection } from "next/server";
import { avatarUrl } from "./avatars";
import { displayNames } from "./auth/session";
import { getDb } from "./db/client";
import { agents, debateParticipants, debates, user, votes } from "./db/schema";
import { agentStandings, rank, userStandings, type FinalDebate } from "./leaderboard";

/** How many rows each board shows. */
export const LEADERBOARD_SIZE = 50;

/** Both leaderboards, from every debate whose voting has closed. */
export async function loadLeaderboards() {
  // Which debates are final depends on the current time: never prerender this.
  await connection();
  const now = Date.now();
  const db = await getDb();

  const closed = await db
    .select({ id: debates.id, votingClosesAt: debates.votingClosesAt })
    .from(debates)
    .where(and(eq(debates.status, "completed"), lte(debates.votingClosesAt, now)));
  const ids = closed.map((d) => d.id);
  const [participants, voteRows] = ids.length
    ? await Promise.all([
        db
          .select({
            id: debateParticipants.id,
            debateId: debateParticipants.debateId,
            agentId: debateParticipants.agentId,
            userId: debateParticipants.userId,
          })
          .from(debateParticipants)
          .where(inArray(debateParticipants.debateId, ids)),
        db
          .select({ debateId: votes.debateId, participantId: votes.participantId, userId: votes.userId })
          .from(votes)
          .where(inArray(votes.debateId, ids)),
      ])
    : [[], []];

  const finals: FinalDebate[] = closed.map((d) => ({
    id: d.id,
    votingClosesAt: d.votingClosesAt ?? now,
    participants: participants.filter((p) => p.debateId === d.id),
    votes: voteRows.filter((v) => v.debateId === d.id),
  }));

  const agentRows = rank(agentStandings(finals)).slice(0, LEADERBOARD_SIZE);
  // People who deleted their account keep their debates' history, but drop off the users board.
  const deleted = new Set((await db.select({ id: user.id }).from(user).where(isNotNull(user.deletedAt))).map((u) => u.id));
  const userTable = userStandings(finals);
  for (const id of deleted) userTable.delete(id);
  const userRows = rank(userTable).slice(0, LEADERBOARD_SIZE);

  const agentInfo = agentRows.length
    ? await db
        .select({
          id: agents.id,
          name: agents.name,
          visibility: agents.visibility,
          ownerId: agents.ownerId,
          imageUpdatedAt: agents.imageUpdatedAt,
          avatarSeed: agents.avatarSeed,
        })
        .from(agents)
        .where(inArray(agents.id, agentRows.map((r) => r.key)))
    : [];
  const infoById = new Map(agentInfo.map((a) => [a.id, a]));
  const names = await displayNames([...userRows.map((r) => r.key), ...agentInfo.map((a) => a.ownerId)]);

  return {
    agents: agentRows.flatMap((r) => {
      const info = infoById.get(r.key);
      if (!info) return []; // deleted between the two queries
      return [
        {
          ...r,
          name: info.name,
          isPublic: info.visibility === "public",
          ownerName: names.get(info.ownerId) ?? "Unknown",
          avatarUrl: avatarUrl(info),
        },
      ];
    }),
    users: userRows.map((r) => ({ ...r, name: names.get(r.key) ?? "Unknown" })),
  };
}
