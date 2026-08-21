import { CaptureJournal, captureScopeHash } from "./capture-journal.js";
import {
  configureCaptureJournal,
  hydrateTrackedCapture,
  replayHydratedCapture,
} from "./heartbeat.js";
import type { KanonClient } from "./kanon-client.js";
import type { WorkCaptureHydrationIntent } from "./work-capture.js";

function jwtSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof value.sub === "string" && value.sub.length > 0 ? value.sub : null;
  } catch {
    return null;
  }
}

export async function recoverWorkCaptures(input: {
  client: KanonClient;
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
  journal?: CaptureJournal;
  log?: (message: string, error?: unknown) => void;
}): Promise<{
  degraded: boolean;
  hydrated: number;
  principalId: string | null;
  scopeHash: string | null;
}> {
  const journal = input.journal ?? new CaptureJournal();
  const log = input.log ?? ((message: string, error?: unknown) => console.error(message, error));
  const fallbackPrincipalId = jwtSubject(input.apiKey);
  const intents: WorkCaptureHydrationIntent[] = [];
  let cursor: string | undefined;
  let principalId: string | null = null;

  try {
    do {
      const page = await input.client.listWorkCaptures(input.workspaceId, cursor, 100);
      if (page.workspaceId !== input.workspaceId) {
        throw new Error("Capture hydration workspace changed between pages");
      }
      if (principalId && page.principalId !== principalId) {
        throw new Error("Capture hydration principal changed between pages");
      }
      principalId = page.principalId;
      intents.push(...page.intents);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  } catch (error) {
    principalId = fallbackPrincipalId;
    if (principalId) {
      const scopeHash = captureScopeHash(input.apiUrl, principalId, input.workspaceId);
      configureCaptureJournal({ journal, scopeHash });
      await journal.scan(scopeHash);
      log("[capture-recovery] Hydration unavailable; legacy tools remain enabled", error);
      return { degraded: true, hydrated: 0, principalId, scopeHash };
    }
    configureCaptureJournal(null);
    log("[capture-recovery] Hydration unavailable and JWT subject is unavailable", error);
    return { degraded: true, hydrated: 0, principalId: null, scopeHash: null };
  }

  if (!principalId) principalId = fallbackPrincipalId;
  if (!principalId) {
    configureCaptureJournal(null);
    log("[capture-recovery] API returned no principal identity");
    return { degraded: true, hydrated: 0, principalId: null, scopeHash: null };
  }

  const scopeHash = captureScopeHash(input.apiUrl, principalId, input.workspaceId);
  configureCaptureJournal({ journal, scopeHash });
  const signals = await journal.scan(scopeHash);
  const byIssue = new Map(intents.map((intent) => [intent.issueKey, intent]));
  const validSignals = [];
  for (const signal of signals) {
    const intent = byIssue.get(signal.record.issueKey);
    if (!intent) continue;
    if (
      intent.epoch !== signal.record.command.epoch ||
      intent.leaseGeneration !== signal.record.command.leaseGeneration ||
      (intent.state === "paused" && signal.record.kind === "activity") ||
      (intent.state === "closing" && signal.record.kind !== "close")
    ) {
      await journal.remove(signal);
      continue;
    }
    validSignals.push(signal);
  }

  const legacyFallbackKeys = new Set(
    validSignals
      .filter((signal) => signal.record.version === 2)
      .map(
        (signal) =>
          `${signal.record.issueKey}\0${signal.record.kind}\0${signal.record.command.commandId}\0${signal.record.command.epoch}\0${signal.record.command.leaseGeneration}`
      )
  );
  const replaySignals: typeof validSignals = [];
  for (const signal of validSignals) {
    const commandKey = `${signal.record.issueKey}\0${signal.record.kind}\0${signal.record.command.commandId}\0${signal.record.command.epoch}\0${signal.record.command.leaseGeneration}`;
    if (signal.record.version === 3 && legacyFallbackKeys.has(commandKey)) {
      await journal.remove(signal);
      continue;
    }
    replaySignals.push(signal);
  }

  const strength = { activity: 1, release: 2, close: 3 } as const;
  const strongestByIssue = new Map<string, (typeof replaySignals)[number]>();
  for (const signal of replaySignals) {
    const current = strongestByIssue.get(signal.record.issueKey);
    if (!current || strength[signal.record.kind] > strength[current.record.kind]) {
      strongestByIssue.set(signal.record.issueKey, signal);
    }
  }

  for (const intent of intents) {
    hydrateTrackedCapture({
      issueKey: intent.issueKey,
      client: input.client,
      captureIntent: intent,
      ...(strongestByIssue.get(intent.issueKey)
        ? { signal: strongestByIssue.get(intent.issueKey)! }
        : {}),
    });
  }

  const immediate = [...strongestByIssue.values()]
    .filter((signal) => signal.record.kind !== "activity")
    .sort((left, right) => strength[right.record.kind] - strength[left.record.kind]);
  for (const signal of immediate) {
    try {
      await replayHydratedCapture(signal.record.issueKey);
      for (const superseded of replaySignals) {
        if (
          superseded.path !== signal.path &&
          superseded.record.issueKey === signal.record.issueKey &&
          strength[superseded.record.kind] <= strength[signal.record.kind]
        ) {
          await journal.remove(superseded);
        }
      }
    } catch (error) {
      log(
        `[capture-recovery] Failed to replay ${signal.record.kind} for ${signal.record.issueKey}`,
        error
      );
    }
  }

  return { degraded: false, hydrated: intents.length, principalId, scopeHash };
}
