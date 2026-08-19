import { fetchApiValidated } from "@/lib/api-client";
import {
  NavigatorWorkCaptureLock,
  WorkCaptureBrowserStore,
  captureScopeKey,
  type CaptureScope,
  type WorkCaptureStorage,
} from "./work-capture-browser-store";
import {
  WorkCaptureRegistry,
  type WorkCaptureRegistrySnapshot,
} from "./work-capture-registry";

interface CaptureRegistryPort {
  activateScope(scope: CaptureScope, options?: { releasePrevious?: boolean }): Promise<void>;
  recordActivity(issueKey: string): Promise<void>;
  releaseScope(scope: CaptureScope, options: { keepalive: boolean }): Promise<void>;
  getSnapshot(): WorkCaptureRegistrySnapshot;
  subscribe(listener: () => void): () => void;
}

interface WorkCaptureLifecycleOptions {
  registry: CaptureRegistryPort;
  store: WorkCaptureBrowserStore;
  tabId: string;
  documentTarget: Document;
  windowTarget: Window;
  membershipHeartbeatMs?: number;
}

type DeactivateReason = "logout" | "scope-switch" | "pagehide";

function sameScope(left: CaptureScope | null, right: CaptureScope | null): boolean {
  return (
    left?.principalId === right?.principalId && left?.workspaceId === right?.workspaceId
  );
}

export function createWorkCaptureLifecycle(options: WorkCaptureLifecycleOptions) {
  let currentScope: CaptureScope | null = null;
  let activation: { scopeKey: string; promise: Promise<void> } | null = null;
  let hydratedScopeKey: string | null = null;
  let operationTail = Promise.resolve();
  let membershipTimer: ReturnType<typeof setInterval> | null = null;
  const heartbeatMs = options.membershipHeartbeatMs ?? 15_000;

  const stopMembershipHeartbeat = () => {
    if (membershipTimer !== null) clearInterval(membershipTimer);
    membershipTimer = null;
  };

  const startMembershipHeartbeat = () => {
    stopMembershipHeartbeat();
    membershipTimer = setInterval(() => {
      if (currentScope) void options.store.touchScope(currentScope, options.tabId);
    }, heartbeatMs);
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const running = operationTail.catch(() => undefined).then(operation);
    operationTail = running.catch(() => undefined);
    return running;
  };

  const performDeactivate = async (reason: DeactivateReason): Promise<void> => {
    const scope = currentScope;
    if (!scope) return;
    currentScope = null;
    hydratedScopeKey = null;
    stopMembershipHeartbeat();
    const { isFinal } = await options.store.leaveScope(scope, options.tabId);
    if (isFinal) {
      await options.registry.releaseScope(scope, { keepalive: reason === "pagehide" });
    }
  };

  const deactivateCurrent = (reason: DeactivateReason): Promise<void> =>
    enqueue(() => performDeactivate(reason));

  const activateScope = (scope: CaptureScope): Promise<void> => {
    const key = captureScopeKey(scope);
    if (activation?.scopeKey === key) return activation.promise;
    if (sameScope(currentScope, scope) && hydratedScopeKey === key) return Promise.resolve();

    const promise = enqueue(async () => {
      if (sameScope(currentScope, scope)) {
        await options.registry.activateScope(scope, { releasePrevious: false });
        hydratedScopeKey = key;
        return;
      }
      const previous = currentScope;
      if (previous && !sameScope(previous, scope)) {
        const { isFinal } = await options.store.leaveScope(previous, options.tabId);
        if (isFinal) {
          await options.registry.releaseScope(previous, { keepalive: false });
        }
      }
      await options.store.joinScope(scope, options.tabId);
      currentScope = scope;
      startMembershipHeartbeat();
      await options.registry.activateScope(scope, { releasePrevious: false });
      hydratedScopeKey = key;
    });
    activation = { scopeKey: key, promise };
    void promise.finally(() => {
      if (activation?.promise === promise) activation = null;
    });
    return promise;
  };

  const findIssueKey = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const marker = target.closest<HTMLElement>("[data-issue-key], [data-current-issue-key]");
    const issueKey = marker?.dataset.issueKey ?? marker?.dataset.currentIssueKey;
    return issueKey && issueKey.trim() !== "" ? issueKey : null;
  };

  const installActivityListeners = (): (() => void) => {
    const handleActivity = (event: Event) => {
      const issueKey = findIssueKey(event.target);
      if (issueKey) void options.registry.recordActivity(issueKey);
    };
    const handlePageHide = () => {
      // The command is persisted before its keepalive request, but pagehide is
      // inherently best-effort. Server lease expiry remains the crash fallback.
      void deactivateCurrent("pagehide");
    };
    options.documentTarget.addEventListener("pointerdown", handleActivity, { capture: true });
    options.documentTarget.addEventListener("keydown", handleActivity, { capture: true });
    options.windowTarget.addEventListener("pagehide", handlePageHide);

    return () => {
      options.documentTarget.removeEventListener("pointerdown", handleActivity, { capture: true });
      options.documentTarget.removeEventListener("keydown", handleActivity, { capture: true });
      options.windowTarget.removeEventListener("pagehide", handlePageHide);
      // React cleanup only unregisters listeners. It never releases ownership.
    };
  };

  return {
    activateScope,
    deactivateCurrent,
    installActivityListeners,
    getSnapshot: options.registry.getSnapshot.bind(options.registry),
    subscribe: options.registry.subscribe.bind(options.registry),
  };
}

function browserStorage(): WorkCaptureStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}

function browserTabId(): string {
  const key = "kanon.work-capture.tab.v1";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

const defaultBrowserStore = new WorkCaptureBrowserStore({
  storage: browserStorage(),
  lock: new NavigatorWorkCaptureLock(),
});

export const workCaptureRegistry = new WorkCaptureRegistry({
  store: defaultBrowserStore,
  request: (path, schema, init) => fetchApiValidated(path, schema, init),
});

export const workCaptureLifecycle = createWorkCaptureLifecycle({
  registry: workCaptureRegistry,
  store: defaultBrowserStore,
  tabId: browserTabId(),
  documentTarget: document,
  windowTarget: window,
});
