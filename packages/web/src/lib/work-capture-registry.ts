import {
  workCaptureEffectResponseSchema,
  workCaptureFenceSchema,
  workCaptureHydrationPageSchema,
  type WorkCaptureEffectResponse,
  type WorkCaptureHydrationIntent,
} from "@kanon/shared";
import { z, type ZodTypeAny } from "zod";
import { ApiError } from "@/lib/api-client";
import {
  captureScopeKey,
  type CaptureScope,
  type PersistedCaptureCommand,
  type WorkCaptureBrowserStore,
} from "./work-capture-browser-store";

export type WorkCaptureEntryStatus =
  | "passive"
  | "claiming"
  | "retrying-claim"
  | "claim-accepted"
  | "owned"
  | "releasing"
  | "retrying-release";

export interface WorkCaptureRegistryEntry {
  issueKey: string;
  epoch: string;
  leaseGeneration: number;
  status: WorkCaptureEntryStatus;
}

export interface WorkCaptureRegistrySnapshot {
  scope: CaptureScope | null;
  generation: number;
  entries: Readonly<Record<string, WorkCaptureRegistryEntry>>;
}

type RequestFn = (path: string, schema: ZodTypeAny, init?: RequestInit) => Promise<unknown>;
type ScheduleToken = unknown;

interface WorkCaptureRegistryOptions {
  store: WorkCaptureBrowserStore;
  request: RequestFn;
  randomUUID?: () => string;
  schedule?: (operation: () => void, delayMs: number) => ScheduleToken;
  cancelSchedule?: (token: ScheduleToken) => void;
  retryBaseMs?: number;
  retryMaxMs?: number;
  activityThrottleMs?: number;
  now?: () => number;
}

const ownerCommandSchema = z
  .object({
    commandId: z.string().uuid(),
    epoch: z.string().uuid(),
    leaseGeneration: z.number().int().positive(),
    ownerId: z.string().uuid(),
  })
  .strict();

type OwnerCommand = z.infer<typeof ownerCommandSchema>;

function scopesEqual(left: CaptureScope | null, right: CaptureScope | null): boolean {
  return left?.principalId === right?.principalId && left?.workspaceId === right?.workspaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acceptedStatus(response: WorkCaptureEffectResponse): "owned" | "claim-accepted" {
  return response.deliveryStatus === "pending" ? "claim-accepted" : "owned";
}

function hasReleaseObligation(status: WorkCaptureEntryStatus): boolean {
  return ["claim-accepted", "owned", "releasing", "retrying-release"].includes(status);
}

export class WorkCaptureRegistry {
  private readonly store: WorkCaptureBrowserStore;
  private readonly request: RequestFn;
  private readonly randomUUID: () => string;
  private readonly schedule: (operation: () => void, delayMs: number) => ScheduleToken;
  private readonly cancelSchedule: (token: ScheduleToken) => void;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly activityThrottleMs: number;
  private readonly now: () => number;
  private snapshot: WorkCaptureRegistrySnapshot = { scope: null, generation: 0, entries: {} };
  private readonly listeners = new Set<() => void>();
  private hydration: { scopeKey: string; promise: Promise<void> } | null = null;
  private hydratedScopeKey: string | null = null;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly retryTokens = new Set<ScheduleToken>();
  private readonly lastActivityAt = new Map<string, number>();
  private readonly closingScopes = new Map<string, boolean>();

  constructor(options: WorkCaptureRegistryOptions) {
    this.store = options.store;
    this.request = options.request;
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
    this.schedule = options.schedule ?? ((operation, delay) => setTimeout(operation, delay));
    this.cancelSchedule = options.cancelSchedule ?? ((token) => clearTimeout(token as number));
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    this.activityThrottleMs = options.activityThrottleMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  getSnapshot = (): WorkCaptureRegistrySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(
    scope: CaptureScope | null,
    generation: number,
    entries: Record<string, WorkCaptureRegistryEntry>
  ): void {
    this.snapshot = { scope, generation, entries };
    for (const listener of this.listeners) listener();
  }

  private updateEntry(issueKey: string, update: WorkCaptureRegistryEntry | null): void {
    const entries = { ...this.snapshot.entries };
    if (update) entries[issueKey] = update;
    else delete entries[issueKey];
    this.publish(this.snapshot.scope, this.snapshot.generation, entries);
  }

  async activateScope(
    scope: CaptureScope,
    options: { releasePrevious?: boolean } = {}
  ): Promise<void> {
    const key = captureScopeKey(scope);
    this.closingScopes.delete(key);
    if (this.hydration?.scopeKey === key) return this.hydration.promise;
    if (
      scopesEqual(this.snapshot.scope, scope) &&
      this.hydration === null &&
      this.hydratedScopeKey === key
    ) {
      return;
    }

    const previous = this.snapshot.scope;
    const generation = this.snapshot.generation + 1;
    this.publish(previous, generation, { ...this.snapshot.entries });

    const promise = (async () => {
      if (previous && !scopesEqual(previous, scope) && options.releasePrevious !== false) {
        this.closingScopes.set(captureScopeKey(previous), false);
        await this.releaseEntries(previous, { keepalive: false }, generation);
      }
      if (this.snapshot.generation !== generation) return;
      this.publish(
        scope,
        generation,
        scopesEqual(previous, scope) ? { ...this.snapshot.entries } : {}
      );
      await this.hydrate(scope, generation);
      if (this.snapshot.generation === generation && scopesEqual(this.snapshot.scope, scope)) {
        this.hydratedScopeKey = key;
      }
    })();
    this.hydration = { scopeKey: key, promise };
    try {
      await promise;
    } finally {
      if (this.hydration?.promise === promise) this.hydration = null;
    }
  }

  private async hydrate(scope: CaptureScope, generation: number): Promise<void> {
    const intents: WorkCaptureHydrationIntent[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    do {
      const query = new URLSearchParams({ workspaceId: scope.workspaceId, limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const path = `/api/me/work-captures?${query.toString()}`;
      const raw = await this.request(path, workCaptureHydrationPageSchema, {
        headers: { "X-Kanon-Client": "web" },
      });
      const page = workCaptureHydrationPageSchema.parse(raw);
      if (page.principalId !== scope.principalId || page.workspaceId !== scope.workspaceId) {
        throw new Error("Work-capture hydration scope echo mismatch");
      }
      intents.push(...page.intents);
      if (page.nextCursor !== null) {
        if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
          throw new Error("Work-capture hydration cursor did not progress");
        }
        seenCursors.add(page.nextCursor);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    if (this.snapshot.generation !== generation || !scopesEqual(this.snapshot.scope, scope)) return;

    const obligations = await this.store.listObligations(scope);
    if (this.snapshot.generation !== generation || !scopesEqual(this.snapshot.scope, scope)) return;
    const obligationByIssue = new Map(
      obligations.map((obligation) => [obligation.issueKey, obligation])
    );
    const entries: Record<string, WorkCaptureRegistryEntry> = {};
    for (const intent of intents) {
      const obligation = obligationByIssue.get(intent.issueKey);
      const matches =
        obligation?.epoch === intent.epoch && obligation.leaseGeneration === intent.leaseGeneration;
      entries[intent.issueKey] = {
        issueKey: intent.issueKey,
        epoch: intent.epoch,
        leaseGeneration: intent.leaseGeneration,
        status: matches
          ? obligation.acceptance === "pending"
            ? "claim-accepted"
            : "owned"
          : "passive",
      };
      if (obligation && !matches) void this.store.removeObligation(scope, intent.issueKey);
    }
    this.publish(scope, generation, entries);
    await this.replayPersistedCommands(scope, generation);
  }

  private async replayPersistedCommands(scope: CaptureScope, generation: number): Promise<void> {
    const commands = await this.store.listCommands(scope);
    if (this.snapshot.generation !== generation || !scopesEqual(this.snapshot.scope, scope)) return;
    await Promise.all(commands.map((command) => this.runPersistedCommand(command)));
  }

  recordActivity(issueKey: string): Promise<void> {
    const scope = this.snapshot.scope;
    const entry = this.snapshot.entries[issueKey];
    if (
      !scope ||
      !entry ||
      ["claiming", "retrying-claim", "releasing", "retrying-release"].includes(entry.status)
    ) {
      return Promise.resolve();
    }
    const key = `${captureScopeKey(scope)}:${issueKey}`;
    const previous = this.lastActivityAt.get(key);
    if (
      entry.status !== "passive" &&
      previous !== undefined &&
      this.now() - previous < this.activityThrottleMs
    ) {
      return Promise.resolve();
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const running = this.prepareActivity(scope, entry, key).finally(() => {
      if (this.inFlight.get(key) === running) this.inFlight.delete(key);
    });
    this.inFlight.set(key, running);
    return running;
  }

  private async prepareActivity(
    scope: CaptureScope,
    entry: WorkCaptureRegistryEntry,
    key: string
  ): Promise<void> {
    const ownerId = await this.store.getOwnerId();
    const body = JSON.stringify({
      commandId: this.randomUUID(),
      epoch: entry.epoch,
      leaseGeneration: entry.leaseGeneration,
      ownerId,
    });
    const persisted: PersistedCaptureCommand = {
      scope,
      issueKey: entry.issueKey,
      kind: "activity",
      body,
    };
    await this.store.putCommand(persisted);
    if (!scopesEqual(this.snapshot.scope, scope)) return;
    this.lastActivityAt.set(key, this.now());
    this.updateEntry(entry.issueKey, { ...entry, status: "claiming" });
    return this.executeCommand(persisted, 0, false);
  }

  async releaseScope(scope: CaptureScope, options: { keepalive: boolean }): Promise<void> {
    this.closingScopes.set(captureScopeKey(scope), options.keepalive);
    await this.releaseEntries(scope, options, this.snapshot.generation);
  }

  private async releaseEntries(
    scope: CaptureScope,
    options: { keepalive: boolean },
    generation: number
  ): Promise<void> {
    if (!scopesEqual(this.snapshot.scope, scope)) return;
    const entriesByIssue = new Map(
      Object.values(this.snapshot.entries)
        .filter((entry) => hasReleaseObligation(entry.status))
        .map((entry) => [entry.issueKey, entry])
    );
    for (const obligation of await this.store.listObligations(scope)) {
      entriesByIssue.set(obligation.issueKey, {
        issueKey: obligation.issueKey,
        epoch: obligation.epoch,
        leaseGeneration: obligation.leaseGeneration,
        status: obligation.acceptance === "pending" ? "claim-accepted" : "owned",
      });
    }
    const entries = [...entriesByIssue.values()];
    await Promise.all(
      entries.map(async (entry) => {
        const ownerId = await this.store.getOwnerId();
        const body = JSON.stringify({
          commandId: this.randomUUID(),
          epoch: entry.epoch,
          leaseGeneration: entry.leaseGeneration,
          ownerId,
        });
        const command: PersistedCaptureCommand = {
          scope,
          issueKey: entry.issueKey,
          kind: "release",
          body,
        };
        await this.store.putCommand(command);
        if (this.snapshot.generation === generation && scopesEqual(this.snapshot.scope, scope)) {
          this.updateEntry(entry.issueKey, { ...entry, status: "releasing" });
        }
        await this.startCommand(command, options.keepalive);
      })
    );
  }

  private startCommand(command: PersistedCaptureCommand, keepalive = false): Promise<void> {
    const key = `${captureScopeKey(command.scope)}:${command.issueKey}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const running = this.executeCommand(command, 0, keepalive).finally(() => {
      if (this.inFlight.get(key) === running) this.inFlight.delete(key);
    });
    this.inFlight.set(key, running);
    return running;
  }

  private async runPersistedCommand(command: PersistedCaptureCommand): Promise<void> {
    const parsed = ownerCommandSchema.safeParse(JSON.parse(command.body));
    if (!parsed.success) return;
    const entry = this.snapshot.entries[command.issueKey];
    if (
      !entry ||
      entry.epoch !== parsed.data.epoch ||
      entry.leaseGeneration !== parsed.data.leaseGeneration
    ) {
      return;
    }
    this.updateEntry(command.issueKey, {
      ...entry,
      status: command.kind === "activity" ? "claiming" : "releasing",
    });
    return this.startCommand(command);
  }

  private async executeCommand(
    command: PersistedCaptureCommand,
    attempt: number,
    keepalive: boolean
  ): Promise<void> {
    const parsedBody = ownerCommandSchema.parse(JSON.parse(command.body));
    const encodedKey = encodeURIComponent(command.issueKey);
    const path =
      command.kind === "activity"
        ? `/api/issues/${encodedKey}/work-sessions/heartbeat`
        : `/api/issues/${encodedKey}/work-captures/release`;
    try {
      const raw = await this.request(path, workCaptureEffectResponseSchema, {
        method: "POST",
        headers: { "X-Kanon-Client": "web" },
        body: command.body,
        keepalive,
      });
      const response = workCaptureEffectResponseSchema.parse(raw);
      if (response.commandId !== parsedBody.commandId) {
        throw new Error("Work-capture command response mismatch");
      }
      await this.acceptCommand(command, parsedBody, response);
    } catch (error) {
      if (!this.isRetryable(error)) throw error;
      const current = this.snapshot.entries[command.issueKey];
      if (current && scopesEqual(this.snapshot.scope, command.scope)) {
        this.updateEntry(command.issueKey, {
          ...current,
          status: command.kind === "activity" ? "retrying-claim" : "retrying-release",
        });
      }
      const delay = Math.min(this.retryBaseMs * 2 ** attempt, this.retryMaxMs);
      await new Promise<void>((resolve) => {
        const token = this.schedule(() => {
          this.retryTokens.delete(token);
          resolve();
        }, delay);
        this.retryTokens.add(token);
      });
      return this.executeCommand(command, attempt + 1, keepalive);
    }
  }

  private isRetryable(error: unknown): boolean {
    return error instanceof TypeError || (error instanceof ApiError && error.status === 503);
  }

  private async acceptCommand(
    command: PersistedCaptureCommand,
    parsedBody: OwnerCommand,
    response: WorkCaptureEffectResponse
  ): Promise<void> {
    if (command.kind === "release") {
      await this.store.removeObligation(command.scope, command.issueKey);
      await this.store.removeCommand(command.scope, command.issueKey);
      if (scopesEqual(this.snapshot.scope, command.scope)) this.updateEntry(command.issueKey, null);
      return;
    }

    const epoch = response.captureIntent?.epoch ?? parsedBody.epoch;
    const leaseGeneration = response.captureIntent?.leaseGeneration ?? parsedBody.leaseGeneration;
    await this.store.putObligation({
      scope: command.scope,
      issueKey: command.issueKey,
      epoch,
      leaseGeneration,
      acceptance: response.deliveryStatus,
    });
    await this.store.removeCommand(command.scope, command.issueKey);
    const closingKeepalive = this.closingScopes.get(captureScopeKey(command.scope));
    if (closingKeepalive !== undefined) {
      const releaseBody = JSON.stringify({
        commandId: this.randomUUID(),
        epoch,
        leaseGeneration,
        ownerId: parsedBody.ownerId,
      });
      const releaseCommand: PersistedCaptureCommand = {
        scope: command.scope,
        issueKey: command.issueKey,
        kind: "release",
        body: releaseBody,
      };
      await this.store.putCommand(releaseCommand);
      if (scopesEqual(this.snapshot.scope, command.scope)) {
        this.updateEntry(command.issueKey, {
          issueKey: command.issueKey,
          epoch,
          leaseGeneration,
          status: "releasing",
        });
      }
      await this.executeCommand(releaseCommand, 0, closingKeepalive);
      return;
    }
    if (!scopesEqual(this.snapshot.scope, command.scope)) return;
    this.updateEntry(command.issueKey, {
      issueKey: command.issueKey,
      epoch,
      leaseGeneration,
      status: acceptedStatus(response),
    });
  }

  reconcileDomainEvent(frame: unknown): void {
    if (!isRecord(frame) || !isRecord(frame["payload"])) return;
    const type = frame["type"];
    if (type === "work_capture.intent_effect_requested") return;
    if (type !== "work_session.started" && type !== "work_session.ended") return;
    const scope = this.snapshot.scope;
    if (!scope || frame["workspaceId"] !== scope.workspaceId) return;
    const payload = frame["payload"];
    if (payload["userId"] !== scope.principalId || typeof payload["issueKey"] !== "string") return;
    const issueKey = payload["issueKey"];
    const entry = this.snapshot.entries[issueKey];
    if (!entry) return;
    if (type === "work_session.started") {
      if (entry.status === "passive") return;
      const captureIntent = workCaptureFenceSchema.safeParse(payload["captureIntent"]);
      if (!captureIntent.success || captureIntent.data.epoch !== entry.epoch) return;
      if (captureIntent.data.leaseGeneration < entry.leaseGeneration) return;
      this.updateEntry(issueKey, { ...entry, ...captureIntent.data, status: "owned" });
      void this.store.putObligation({
        scope,
        issueKey,
        ...captureIntent.data,
        acceptance: "acknowledged",
      });
    } else {
      const captureIntent = workCaptureFenceSchema.safeParse(payload["captureIntent"]);
      if (payload["reason"] === "expired" && captureIntent.success) {
        if (captureIntent.data.epoch !== entry.epoch) return;
        if (captureIntent.data.leaseGeneration < entry.leaseGeneration) return;
        this.updateEntry(issueKey, { ...entry, ...captureIntent.data, status: "passive" });
        void this.store.removeObligation(scope, issueKey);
        return;
      }
      this.updateEntry(issueKey, null);
      void this.store.removeObligation(scope, issueKey);
    }
  }

  recordTransitionResult(result: unknown): void {
    if (!isRecord(result) || typeof result["key"] !== "string") return;
    void this.recordActivity(result["key"]);
  }

  recordBatchTransitionResult(result: unknown): void {
    if (!isRecord(result) || !Array.isArray(result["keys"])) return;
    for (const key of result["keys"]) {
      if (typeof key === "string") void this.recordActivity(key);
    }
  }

  dispose(): void {
    for (const token of this.retryTokens) this.cancelSchedule(token);
    this.retryTokens.clear();
    this.listeners.clear();
  }
}
