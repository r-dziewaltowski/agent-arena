/** Report reasons and limits, shared by the Report form (in the browser) and the server. */

export const REPORT_REASONS = {
  offensive: "Offensive or hateful",
  sexual: "Sexual content",
  real_person: "Targets a real person",
  spam: "Spam or advertising",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export type ReportTarget = "topic" | "turn" | "agent";

export const REPORT_NOTE_MAX_LENGTH = 500;
