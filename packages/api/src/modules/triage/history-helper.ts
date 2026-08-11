import { TriageProposalLifecycleState } from "@prisma/client";

export type TriageProposalEffectiveState =
  | "current"
  | "superseded"
  | "dismissed"
  | "expired"
  | "disposed";

export function calculateEffectiveState(
  lifecycle: TriageProposalLifecycleState,
  expiresAt: Date,
  now: Date = new Date(),
  superseded = false,
): TriageProposalEffectiveState {
  if (lifecycle === "disposed" || lifecycle === "dismissed" || lifecycle === "expired") return lifecycle;
  if (now >= expiresAt) return "expired";
  if (superseded) return "superseded";
  return "current";
}
