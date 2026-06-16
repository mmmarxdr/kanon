export interface ForecastNode {
  issueId: string;
  startDate: Date | null;
  dueDate: Date | null;
  estimateHours: number | null;
  progress: number;
  state: string;
  completedAt: Date | null;
  loggedH: number;
  /** KAN-103 PR3: whole days displaced by interruptions (incident switch). Pure input — engine shifts forecastEnd accordingly. */
  interruptedDays: number;
}

export interface ForecastEdge {
  source: string;
  target: string;
  type: "FS" | "SS" | "FF" | "SF" | "blocks";
  lagDays: number;
}

export interface ForecastMilestoneInput {
  id: string;
  target: Date | null;
  status: string;
  deliverableIssueIds: string[];
}

export interface ForecastGraphInput {
  nodes: ForecastNode[];
  edges: ForecastEdge[];
  milestones: ForecastMilestoneInput[];
}

export interface IssueForecastEntry {
  forecastStart: Date | null;
  forecastEnd: Date | null;
  critical: boolean;
  floatDays: number | null;
  slipDays: number;
  computedAt: Date;
}

export interface MilestoneRollup {
  milestoneId: string;
  currentStatus: string;
  computedStatus: string;
}

export interface IssueSlip {
  issueId: string;
  slipDays: number;
  critical: boolean;
}

export interface ForecastStats {
  issueCount: number;
  criticalCount: number;
  worstSlipDays: number;
}

export interface ForecastResult {
  forecasts: Map<string, IssueForecastEntry>;
  milestoneRollups: MilestoneRollup[];
  slips: IssueSlip[];
  stats: ForecastStats;
}
