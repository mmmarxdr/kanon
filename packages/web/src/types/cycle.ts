import type { IssueState } from "@/stores/board-store";
import type { IssuePriority, IssueType } from "./issue";

export type CycleState = "upcoming" | "active" | "done";
export type CycleScopeEventKind = "add" | "remove";

export interface Cycle {
  id: string;
  name: string;
  goal: string | null;
  state: CycleState;
  startDate: string;
  endDate: string;
  velocity: number | null;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CycleScopeEvent {
  id: string;
  day: number;
  kind: CycleScopeEventKind;
  issueKey: string;
  reason: string | null;
  createdAt: string;
  cycleId: string;
  authorId: string | null;
  author?: { id: string; username: string; isAgent: boolean } | null;
}

export interface CycleIssue {
  id: string;
  key: string;
  title: string;
  type: IssueType;
  priority: IssuePriority;
  state: IssueState;
  estimate: number | null;
  updatedAt: string;
  assignee?: { id: string; username: string } | null;
}

export interface CycleRisk {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  action?: string;
}

export interface CycleDetail extends Cycle {
  issues: CycleIssue[];
  scopeEvents: CycleScopeEvent[];
  /** 1-based current day inside the cycle (clamped). */
  dayIndex: number;
  /** Total length of the cycle in days. */
  days: number;
  /** Total story points in scope. */
  scope: number;
  /** Story points completed (state === "done"). */
  completed: number;
  scopeAdded: number;
  scopeRemoved: number;
  burnup: number[];
  scopeLine: number[];
  risks: CycleRisk[];
}
