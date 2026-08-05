import { TriageProposalLifecycleState } from "@prisma/client";

export function calculateEffectiveState(
  lifecycle: TriageProposalLifecycleState,
  expiresAt: Date,
  now: Date = new Date()
): TriageProposalLifecycleState {
  if (lifecycle === "pending" && now > expiresAt) {
    return "expired";
  }
  return lifecycle;
}
