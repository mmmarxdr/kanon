export interface CaptureScope {
  principalId: string;
  workspaceId: string;
}

export type CaptureCommandKind = "activity" | "release";

export interface PersistedCaptureCommand {
  scope: CaptureScope;
  issueKey: string;
  kind: CaptureCommandKind;
  /** Immutable serialized request body. Replays must reuse these exact bytes. */
  body: string;
}

export interface PersistedCaptureObligation {
  scope: CaptureScope;
  issueKey: string;
  epoch: string;
  leaseGeneration: number;
  acceptance: "acknowledged" | "pending";
}

export interface WorkCaptureStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkCaptureLock {
  runExclusive<T>(name: string, operation: () => Promise<T> | T): Promise<T>;
}

interface DurableCaptureState {
  version: 1;
  ownerId?: string;
  memberships: Record<string, Record<string, number>>;
  commands: Record<string, PersistedCaptureCommand>;
  obligations: Record<string, PersistedCaptureObligation>;
}

interface WorkCaptureBrowserStoreOptions {
  storage: WorkCaptureStorage;
  lock: WorkCaptureLock;
  randomUUID?: () => string;
  now?: () => number;
  tabTtlMs?: number;
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "kanon.work-capture.profile.v1";
const DEFAULT_TAB_TTL_MS = 45_000;
const LOCK_NAME = "kanon.work-capture.profile.v1";

function emptyState(): DurableCaptureState {
  return { version: 1, memberships: {}, commands: {}, obligations: {} };
}

export function captureScopeKey(scope: CaptureScope): string {
  return `${scope.principalId}:${scope.workspaceId}`;
}

function issueStorageKey(scope: CaptureScope, issueKey: string): string {
  return `${captureScopeKey(scope)}:${issueKey}`;
}

function sameScope(left: CaptureScope, right: CaptureScope): boolean {
  return left.principalId === right.principalId && left.workspaceId === right.workspaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(raw: string | null): DurableCaptureState {
  if (raw === null) return emptyState();
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    parsed["version"] !== 1 ||
    !isRecord(parsed["memberships"]) ||
    !isRecord(parsed["commands"]) ||
    !isRecord(parsed["obligations"])
  ) {
    throw new Error("Invalid durable work-capture browser state");
  }
  return parsed as unknown as DurableCaptureState;
}

/** Deterministic in-memory storage for unit tests. */
export class MemoryWorkCaptureStorage implements WorkCaptureStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

/** Deterministic lock implementation for unit tests. */
export class SerialWorkCaptureLock implements WorkCaptureLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(name, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }
  }
}

/**
 * Cross-tab lock backed by the Web Locks API. If unavailable, capture fails
 * closed rather than racing profile ownership through module-local state.
 */
export class NavigatorWorkCaptureLock implements WorkCaptureLock {
  async runExclusive<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) throw new Error("Web Locks are required for safe work capture");
    return locks.request(name, { mode: "exclusive" }, operation);
  }
}

export class WorkCaptureBrowserStore {
  private readonly storage: WorkCaptureStorage;
  private readonly lock: WorkCaptureLock;
  private readonly randomUUID: () => string;
  private readonly now: () => number;
  private readonly tabTtlMs: number;
  private readonly storageKey: string;

  constructor(options: WorkCaptureBrowserStoreOptions) {
    this.storage = options.storage;
    this.lock = options.lock;
    this.randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.tabTtlMs = options.tabTtlMs ?? DEFAULT_TAB_TTL_MS;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  private async transaction<T>(operation: (state: DurableCaptureState) => T): Promise<T> {
    return this.lock.runExclusive(LOCK_NAME, () => {
      const state = parseState(this.storage.getItem(this.storageKey));
      const result = operation(state);
      this.storage.setItem(this.storageKey, JSON.stringify(state));
      return result;
    });
  }

  async getOwnerId(): Promise<string> {
    return this.transaction((state) => {
      state.ownerId ??= this.randomUUID();
      return state.ownerId;
    });
  }

  private pruneMembership(members: Record<string, number>, now: number): void {
    for (const [tabId, lastSeenAt] of Object.entries(members)) {
      if (!Number.isFinite(lastSeenAt) || now - lastSeenAt > this.tabTtlMs) delete members[tabId];
    }
  }

  async joinScope(scope: CaptureScope, tabId: string): Promise<{ ownerId: string }> {
    return this.transaction((state) => {
      const now = this.now();
      const key = captureScopeKey(scope);
      const members = state.memberships[key] ?? {};
      this.pruneMembership(members, now);
      members[tabId] = now;
      state.memberships[key] = members;
      state.ownerId ??= this.randomUUID();
      return { ownerId: state.ownerId };
    });
  }

  async touchScope(scope: CaptureScope, tabId: string): Promise<void> {
    await this.transaction((state) => {
      const now = this.now();
      const key = captureScopeKey(scope);
      const members = state.memberships[key] ?? {};
      this.pruneMembership(members, now);
      members[tabId] = now;
      state.memberships[key] = members;
    });
  }

  async leaveScope(scope: CaptureScope, tabId: string): Promise<{ isFinal: boolean }> {
    return this.transaction((state) => {
      const now = this.now();
      const key = captureScopeKey(scope);
      const members = state.memberships[key] ?? {};
      this.pruneMembership(members, now);
      delete members[tabId];
      if (Object.keys(members).length === 0) {
        delete state.memberships[key];
        return { isFinal: true };
      }
      state.memberships[key] = members;
      return { isFinal: false };
    });
  }

  async putCommand(command: PersistedCaptureCommand): Promise<void> {
    await this.transaction((state) => {
      state.commands[issueStorageKey(command.scope, command.issueKey)] = command;
    });
  }

  async removeCommand(scope: CaptureScope, issueKey: string): Promise<void> {
    await this.transaction((state) => {
      delete state.commands[issueStorageKey(scope, issueKey)];
    });
  }

  async listCommands(scope?: CaptureScope): Promise<PersistedCaptureCommand[]> {
    return this.transaction((state) =>
      Object.values(state.commands).filter((command) => !scope || sameScope(command.scope, scope)),
    );
  }

  async putObligation(obligation: PersistedCaptureObligation): Promise<void> {
    await this.transaction((state) => {
      state.obligations[issueStorageKey(obligation.scope, obligation.issueKey)] = obligation;
    });
  }

  async removeObligation(scope: CaptureScope, issueKey: string): Promise<void> {
    await this.transaction((state) => {
      delete state.obligations[issueStorageKey(scope, issueKey)];
    });
  }

  async listObligations(scope: CaptureScope): Promise<PersistedCaptureObligation[]> {
    return this.transaction((state) =>
      Object.values(state.obligations).filter((obligation) => sameScope(obligation.scope, scope)),
    );
  }
}
