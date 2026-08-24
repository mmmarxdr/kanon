// ─── Issue-Scoped Work-Capture Activity Manager ─────────────────────────────

import { randomUUID } from "node:crypto";
import type { KanonClient } from "./kanon-client.js";
import type {
  WorkCaptureCommand,
  WorkCaptureEffectResponse,
  WorkCaptureIntentSnapshot,
  WorkCaptureOwnerCommand,
} from "./work-capture.js";
import type { CaptureJournal, CaptureJournalEntry, CaptureJournalKind } from "./capture-journal.js";

const HEARTBEAT_DEBOUNCE_MS = 2 * 60 * 1000;
const HEARTBEAT_RETRY_MS = 1000;
const CAPTURE_PROCESS_OWNER_ID = randomUUID();

type PendingEffect = {
  kind: "activity" | "release" | "close";
  command: WorkCaptureCommand | WorkCaptureOwnerCommand;
  journalEntry: CaptureJournalEntry | null;
};

interface ActiveEntry {
  client: KanonClient;
  lastBeatAt: number;
  generation: number;
  fence: WorkCaptureIntentSnapshot | null;
  suspended: boolean;
  pending: PendingEffect | null;
  owned: boolean;
}

const activeIssues = new Map<string, ActiveEntry>();
const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();
const issueOperationTails = new Map<string, Promise<void>>();
let generationSeq = 0;
let journalContext: {
  journal: Pick<CaptureJournal, "append" | "remove" | "hasClose">;
  scopeHash: string;
} | null = null;

export function configureCaptureJournal(
  context: {
    journal: Pick<CaptureJournal, "append" | "remove" | "hasClose">;
    scopeHash: string;
  } | null
): void {
  journalContext = context;
}

async function createPendingEffect(
  issueKey: string,
  kind: CaptureJournalKind,
  command: WorkCaptureCommand | WorkCaptureOwnerCommand
): Promise<PendingEffect> {
  const journalEntry = journalContext
    ? await journalContext.journal.append(
        "ownerId" in command
          ? { version: 3, scopeHash: journalContext.scopeHash, issueKey, kind, command }
          : { version: 2, scopeHash: journalContext.scopeHash, issueKey, kind, command }
      )
    : null;
  return { kind, command, journalEntry };
}

async function removeJournalEntry(entry: CaptureJournalEntry | null): Promise<void> {
  if (!entry || !journalContext) return;
  try {
    await journalContext.journal.remove(entry);
  } catch (error) {
    console.error(
      `[capture-journal] Failed to remove acknowledged signal ${entry.fileName}:`,
      error
    );
  }
}

async function persistLegacyFallback(
  issueKey: string,
  pending: PendingEffect,
  command: WorkCaptureCommand
): Promise<void> {
  const context = journalContext;
  if (!context) {
    pending.command = command;
    return;
  }

  const previous = pending.journalEntry;
  const legacyEntry = await context.journal.append({
    version: 2,
    scopeHash: context.scopeHash,
    issueKey,
    kind: pending.kind,
    command,
  });
  pending.command = command;
  pending.journalEntry = legacyEntry;
  if (!previous) return;
  try {
    await context.journal.remove(previous);
  } catch (error) {
    console.error(
      `[capture-journal] Failed to remove superseded owner signal ${previous.fileName}:`,
      error
    );
  }
}

function terminalJournalFailure(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === "CAPTURE_EFFECT_BLOCKED" ||
    code === "CAPTURE_EFFECT_STALE_FENCE" ||
    code === "CAPTURE_INTENT_NOT_FOUND"
  );
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return typeof candidate.status === "number" ? candidate.status : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function clearRetry(issueKey: string): void {
  const retry = pendingRetries.get(issueKey);
  if (retry) clearTimeout(retry);
  pendingRetries.delete(issueKey);
}

function runIssueOperation<T>(issueKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = issueOperationTails.get(issueKey) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  issueOperationTails.set(issueKey, tail);
  return result.finally(() => {
    if (issueOperationTails.get(issueKey) === tail) issueOperationTails.delete(issueKey);
  });
}

export function withIssueCaptureOperations<T>(
  issueKeys: readonly string[],
  operation: () => Promise<T>
): Promise<T> {
  const ordered = [...new Set(issueKeys)].sort();
  const acquire = (index: number): Promise<T> => {
    const key = ordered[index];
    return key === undefined ? operation() : runIssueOperation(key, () => acquire(index + 1));
  };
  return acquire(0);
}

export function getCaptureProcessOwnerId(): string {
  return CAPTURE_PROCESS_OWNER_ID;
}

function newCommand(fence: WorkCaptureIntentSnapshot): WorkCaptureOwnerCommand {
  return {
    commandId: randomUUID(),
    epoch: fence.epoch,
    leaseGeneration: fence.leaseGeneration,
    ownerId: CAPTURE_PROCESS_OWNER_ID,
  };
}

function updateFromResponse(
  issueKey: string,
  generation: number,
  response: { captureIntent: WorkCaptureIntentSnapshot | null } | undefined
): void {
  const current = activeIssues.get(issueKey);
  if (!current || current.generation !== generation) return;
  clearRetry(issueKey);
  if (response?.captureIntent) current.fence = response.captureIntent;
  current.pending = null;
  current.suspended = false;
  current.lastBeatAt = Date.now();
}

function handleFailure(issueKey: string, generation: number, error: unknown): "retry" | "done" {
  const current = activeIssues.get(issueKey);
  if (!current || current.generation !== generation) return "done";
  const status = getStatusCode(error);
  const code = getErrorCode(error);

  if (status === 404) {
    stopAutoHeartbeat(issueKey);
    return "done";
  }
  if (status === 401 || code === "REFRESH_FAILED" || code === "CAPTURE_EFFECT_BLOCKED") {
    clearRetry(issueKey);
    current.suspended = true;
    return "done";
  }
  if (code === "CAPTURE_EFFECT_STALE_FENCE") {
    clearRetry(issueKey);
    current.pending = null;
    current.fence = null;
    current.suspended = false;
    current.lastBeatAt = 0;
    return "done";
  }
  return "retry";
}

async function compatibleHeartbeat(
  issueKey: string,
  client: KanonClient,
  generation: number
): Promise<void> {
  try {
    const response = await client.heartbeat(issueKey);
    updateFromResponse(issueKey, generation, response);
  } catch (error) {
    const outcome = handleFailure(issueKey, generation, error);
    if (outcome === "retry") {
      const current = activeIssues.get(issueKey);
      if (current?.generation === generation) current.lastBeatAt = 0;
    }
    throw error;
  }
}

async function deliverActivity(
  issueKey: string,
  client: KanonClient,
  generation: number,
  isRetry: boolean
): Promise<void> {
  const entry = activeIssues.get(issueKey);
  if (!entry || entry.generation !== generation || entry.suspended) return;

  if (!entry.fence) {
    try {
      await compatibleHeartbeat(issueKey, client, generation);
    } catch {
      // Compatible adoption is best-effort for ordinary activity.
    }
    return;
  }

  if (!entry.pending) {
    entry.pending = await createPendingEffect(issueKey, "activity", newCommand(entry.fence));
  }
  if (entry.pending.kind !== "activity") return;
  const command = entry.pending.command;

  try {
    const response =
      "ownerId" in command
        ? await client.heartbeat(issueKey, command, {
            beforeLegacyFallback: (legacyCommand) =>
              persistLegacyFallback(issueKey, entry.pending!, legacyCommand),
          })
        : await client.heartbeat(issueKey, command);
    await removeJournalEntry(entry.pending.journalEntry);
    updateFromResponse(issueKey, generation, response);
    return;
  } catch (error) {
    if (terminalJournalFailure(error)) await removeJournalEntry(entry.pending.journalEntry);
    if (handleFailure(issueKey, generation, error) !== "retry") return;
  }

  const current = activeIssues.get(issueKey);
  if (!current || current.generation !== generation || current.suspended) return;
  if (!isRetry) {
    clearRetry(issueKey);
    const retry = setTimeout(() => {
      pendingRetries.delete(issueKey);
      void runIssueOperation(issueKey, () => deliverActivity(issueKey, client, generation, true));
    }, HEARTBEAT_RETRY_MS);
    retry.unref?.();
    pendingRetries.set(issueKey, retry);
  }
}

/**
 * Adopt a capture returned by start_work. A returned snapshot is authoritative,
 * so no redundant heartbeat is sent. Null/absent snapshots use one compatible
 * bodyless heartbeat to recover the fence.
 */
export function startAutoHeartbeat(
  issueKey: string,
  client: KanonClient,
  captureIntent?: WorkCaptureIntentSnapshot | null
): void {
  clearRetry(issueKey);
  const generation = ++generationSeq;
  activeIssues.set(issueKey, {
    client,
    lastBeatAt: Date.now(),
    generation,
    fence: captureIntent ?? null,
    suspended: false,
    pending: null,
    owned: true,
  });

  if (!captureIntent) {
    void runIssueOperation(issueKey, async () => {
      try {
        await compatibleHeartbeat(issueKey, client, generation);
      } catch (error) {
        console.error(`[heartbeat] Failed to adopt capture for ${issueKey}:`, error);
      }
    });
  }
}

/** Adopt an issue after a committed active transition using the legacy-compatible heartbeat. */
export async function adoptCaptureByHeartbeat(
  issueKey: string,
  client: KanonClient
): Promise<void> {
  clearRetry(issueKey);
  const generation = ++generationSeq;
  activeIssues.set(issueKey, {
    client,
    lastBeatAt: 0,
    generation,
    fence: null,
    suspended: false,
    pending: null,
    owned: true,
  });
  await compatibleHeartbeat(issueKey, client, generation);
}

/** Exact issue-scoped activity; unrelated registered issues are never touched. */
export async function noteActivity(issueKeys: readonly string[] = []): Promise<void> {
  const now = Date.now();
  await Promise.allSettled(
    [...new Set(issueKeys)].map((issueKey) =>
      runIssueOperation(issueKey, async () => {
        const entry = activeIssues.get(issueKey);
        if (!entry || entry.suspended) return;
        if (!entry.pending && now - entry.lastBeatAt < HEARTBEAT_DEBOUNCE_MS) return;
        entry.lastBeatAt = now;
        await deliverActivity(issueKey, entry.client, entry.generation, false);
      })
    )
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolActivityPolicy =
  | { mode: "activity" }
  | { mode: "handler-owned" }
  | {
      mode: "lifecycle-exclusive";
      issueKeyField: "issue_key" | "issueKey" | "keys";
    };

const DEFAULT_ACTIVITY_POLICY: ToolActivityPolicy = { mode: "activity" };
const TOOL_POLICIES: Readonly<Record<string, ToolActivityPolicy>> = {
  start_work: { mode: "lifecycle-exclusive", issueKeyField: "issue_key" },
  stop_work: { mode: "lifecycle-exclusive", issueKeyField: "issue_key" },
  transition_issue: { mode: "lifecycle-exclusive", issueKeyField: "issueKey" },
  transition_issues: { mode: "handler-owned" },
  report_incident: { mode: "handler-owned" },
};

export function getToolActivityPolicy(toolName: string): ToolActivityPolicy {
  return TOOL_POLICIES[toolName] ?? DEFAULT_ACTIVITY_POLICY;
}

function issueKeysFromInput(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  const keys: string[] = [];
  for (const candidate of [record["issueKey"], record["issue_key"]]) {
    if (typeof candidate === "string" && candidate.length > 0) keys.push(candidate);
  }
  if (Array.isArray(record["keys"])) {
    for (const candidate of record["keys"]) {
      if (typeof candidate === "string" && candidate.length > 0) keys.push(candidate);
    }
  }
  return [...new Set(keys)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapHandlerWithActivity<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  notify: (issueKeys: readonly string[]) => Promise<void> = noteActivity,
  policy: ToolActivityPolicy = DEFAULT_ACTIVITY_POLICY
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (...args: any[]) => {
    const input = args[0];
    if (policy.mode === "handler-owned") return handler(...args);
    if (policy.mode === "lifecycle-exclusive") {
      const record =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      const raw = record[policy.issueKeyField];
      const keys = Array.isArray(raw)
        ? raw.filter((key): key is string => typeof key === "string" && key.length > 0)
        : typeof raw === "string" && raw.length > 0
          ? [raw]
          : [];
      return withIssueCaptureOperations(keys, () => handler(...args));
    }

    const keys = issueKeysFromInput(input);
    if (keys.length > 0) {
      void notify(keys).catch((error) =>
        console.error("[heartbeat] issue activity failed:", error)
      );
    }
    return handler(...args);
  }) as T;
}

export function stopAutoHeartbeat(issueKey: string): void {
  activeIssues.delete(issueKey);
  clearRetry(issueKey);
}

export const forgetTrackedCapture = stopAutoHeartbeat;

export function stopAllAutoHeartbeats(): void {
  activeIssues.clear();
  for (const timer of pendingRetries.values()) clearTimeout(timer);
  pendingRetries.clear();
  issueOperationTails.clear();
}

export function hydrateTrackedCapture(input: {
  issueKey: string;
  client: KanonClient;
  captureIntent: WorkCaptureIntentSnapshot;
  signal?: CaptureJournalEntry;
}): void {
  clearRetry(input.issueKey);
  activeIssues.set(input.issueKey, {
    client: input.client,
    lastBeatAt: 0,
    generation: ++generationSeq,
    fence: input.captureIntent,
    suspended: input.captureIntent.state === "paused" || input.captureIntent.state === "closing",
    pending: input.signal
      ? {
          kind: input.signal.record.kind,
          command: input.signal.record.command,
          journalEntry: input.signal,
        }
      : null,
    owned: false,
  });
}

async function deliverRelease(issueKey: string, entry: ActiveEntry): Promise<void> {
  if (!entry.pending || entry.pending.kind !== "release") return;
  const pending = entry.pending;
  try {
    const response =
      "ownerId" in pending.command
        ? await entry.client.releaseWork(issueKey, pending.command, {
            beforeLegacyFallback: (legacyCommand) =>
              persistLegacyFallback(issueKey, pending, legacyCommand),
          })
        : await entry.client.releaseWork(issueKey, pending.command);
    await removeJournalEntry(pending.journalEntry);
    updateFromResponse(issueKey, entry.generation, response);
  } catch (error) {
    if (terminalJournalFailure(error)) {
      await removeJournalEntry(pending.journalEntry);
      entry.pending = null;
    }
    throw error;
  }
}

export async function replayHydratedCapture(issueKey: string): Promise<void> {
  await runIssueOperation(issueKey, async () => {
    const entry = activeIssues.get(issueKey);
    if (!entry?.pending) return;
    if (entry.pending.kind === "close") {
      await closeTrackedCapture(issueKey, entry.client);
    } else if (entry.pending.kind === "release") {
      await deliverRelease(issueKey, entry);
    }
  });
}

export function getActiveIssueKeys(): string[] {
  return [...activeIssues.keys()];
}

export async function closeTrackedCapture(
  issueKey: string,
  client: KanonClient
): Promise<
  | WorkCaptureEffectResponse
  | {
      ok: boolean;
      deleted: boolean;
      workLog: { id: string; durationS: number } | null;
    }
> {
  const entry = activeIssues.get(issueKey);
  if (!entry?.fence) {
    const result = await client.stopWork(issueKey);
    stopAutoHeartbeat(issueKey);
    return result;
  }

  if (!entry.pending || entry.pending.kind !== "close") {
    entry.pending = await createPendingEffect(issueKey, "close", newCommand(entry.fence));
  }
  const generation = entry.generation;
  try {
    const response =
      "ownerId" in entry.pending.command
        ? await client.closeWork(issueKey, entry.pending.command, {
            beforeLegacyFallback: (legacyCommand) =>
              persistLegacyFallback(issueKey, entry.pending!, legacyCommand),
          })
        : await client.closeWork(issueKey, entry.pending.command);
    await removeJournalEntry(entry.pending.journalEntry);
    const current = activeIssues.get(issueKey);
    if (current?.generation === generation) stopAutoHeartbeat(issueKey);
    return response;
  } catch (error) {
    if (terminalJournalFailure(error)) await removeJournalEntry(entry.pending.journalEntry);
    const current = activeIssues.get(issueKey);
    if (current?.generation === generation) {
      const status = getStatusCode(error);
      const code = getErrorCode(error);
      if (status === 401 || code === "REFRESH_FAILED" || code === "CAPTURE_EFFECT_BLOCKED") {
        current.suspended = true;
      } else if (code === "CAPTURE_EFFECT_STALE_FENCE") {
        current.pending = null;
        current.fence = null;
        current.lastBeatAt = 0;
      }
    }
    throw error;
  }
}

/** Shutdown releases leases but deliberately preserves the server-side intent. */
export async function shutdownAllHeartbeats(): Promise<void> {
  const entries = [...activeIssues.entries()];
  const results = await Promise.allSettled(
    entries.map(([issueKey, original]) =>
      runIssueOperation(issueKey, async () => {
        const entry = activeIssues.get(issueKey);
        if (!entry || entry.generation !== original.generation) return;
        if (!entry.owned) return;
        if (!entry.fence) await compatibleHeartbeat(issueKey, entry.client, entry.generation);
        const adopted = activeIssues.get(issueKey);
        if (!adopted || adopted.generation !== original.generation) {
          throw new Error(`Capture fence unavailable for ${issueKey}`);
        }
        if (!adopted.fence) {
          if (adopted.owned) await adopted.client.stopWork(issueKey);
          return;
        }
        if (adopted.pending?.kind === "close") return;
        if (
          journalContext &&
          (await journalContext.journal.hasClose(journalContext.scopeHash, issueKey, adopted.fence))
        ) {
          return;
        }
        adopted.pending = await createPendingEffect(issueKey, "release", newCommand(adopted.fence));
        await deliverRelease(issueKey, adopted);
      })
    )
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!;
    if (result.status === "rejected") {
      console.error(
        `[heartbeat] Failed to release work session for ${entries[index]![0]}:`,
        result.reason
      );
    }
  }
  stopAllAutoHeartbeats();
}
