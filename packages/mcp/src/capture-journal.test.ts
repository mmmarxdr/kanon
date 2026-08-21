import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_SIGNAL_ADMISSION_THRESHOLD_PER_SCOPE,
  CaptureJournal,
  captureScopeHash,
  resolveCaptureJournalDirectory,
  type CaptureJournalRecord,
} from "./capture-journal.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kan243-capture-journal-"));
  temporaryDirectories.push(directory);
  return directory;
}

function record(overrides: Partial<CaptureJournalRecord> = {}): CaptureJournalRecord {
  return {
    version: 2,
    scopeHash: "a".repeat(64),
    issueKey: "KAN-42",
    kind: "activity",
    command: {
      commandId: randomUUID(),
      epoch: "11111111-1111-4111-8111-111111111111",
      leaseGeneration: 7,
    },
    ...overrides,
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("immutable capture journal", () => {
  it("persists a v3 process owner beside the byte-identical retry command", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    const ownerId = randomUUID();
    const command = {
      commandId: randomUUID(),
      epoch: "11111111-1111-4111-8111-111111111111",
      leaseGeneration: 7,
      ownerId,
    } as const;
    const entry = await journal.append({
      version: 3,
      scopeHash: "a".repeat(64),
      issueKey: "KAN-243",
      kind: "activity",
      command,
    });

    expect(JSON.parse(await readFile(entry.path, "utf8"))).toEqual({
      version: 3,
      scopeHash: "a".repeat(64),
      issueKey: "KAN-243",
      kind: "activity",
      command,
    });
    expect((await journal.scan("a".repeat(64)))[0]?.record).toMatchObject({ command });
  });

  it("derives an isolated scope hash without persisting scope inputs or secrets", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    const scopeHash = captureScopeHash("https://api.example.test/", "principal-1", "workspace-1");
    const entry = await journal.append(record({ scopeHash }));
    const bytes = await readFile(entry.path, "utf8");

    expect(scopeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(scopeHash).toBe(
      createHash("sha256")
        .update("https://api.example.test\0principal-1\0workspace-1")
        .digest("hex")
    );
    expect(bytes).not.toContain("api.example.test");
    expect(bytes).not.toContain("principal-1");
    expect(bytes).not.toContain("workspace-1");
    expect(bytes).not.toContain("token");
    expect(Object.keys(JSON.parse(bytes))).toEqual([
      "version",
      "scopeHash",
      "issueKey",
      "kind",
      "command",
    ]);
  });

  it("canonicalizes one or more trailing API URL slashes into the same scope hash", () => {
    const canonical = captureScopeHash("https://api.example.test", "principal-1", "workspace-1");

    expect(captureScopeHash("https://api.example.test/", "principal-1", "workspace-1")).toBe(
      canonical
    );
    expect(captureScopeHash("https://api.example.test///", "principal-1", "workspace-1")).toBe(
      canonical
    );
  });

  it("uses the documented state directory and rejects a relative override", () => {
    expect(resolveCaptureJournalDirectory({}, "/home/tester")).toBe(
      "/home/tester/.kanon/state/work-capture-journal-v2.d"
    );
    expect(
      resolveCaptureJournalDirectory({ KANON_STATE_DIR: "/secure/state" }, "/home/tester")
    ).toBe("/secure/state");
    expect(() =>
      resolveCaptureJournalDirectory({ KANON_STATE_DIR: "relative" }, "/home/tester")
    ).toThrow(/absolute/);
  });

  it("persists directory 0700 and immutable signal files 0600", async () => {
    const directory = join(await temporaryDirectory(), "nested", "journal");
    const entry = await new CaptureJournal({ directory }).append(record());

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(entry.path)).mode & 0o777).toBe(0o600);
    await expect(writeFile(entry.path, "overwrite", { flag: "wx" })).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("preserves every immutable file from lock-free concurrent writers", async () => {
    const directory = await temporaryDirectory();
    const journals = [new CaptureJournal({ directory }), new CaptureJournal({ directory })];
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        journals[index % 2]!.append(record({ issueKey: `KAN-${index + 1}` }))
      )
    );

    expect(await journals[0]!.scan("a".repeat(64))).toHaveLength(20);
  });

  it("applies the best-effort observed-count admission threshold sequentially", async () => {
    expect(CAPTURE_SIGNAL_ADMISSION_THRESHOLD_PER_SCOPE).toBe(256);
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory, admissionThresholdPerScope: 2 });
    await journal.append(record({ issueKey: "KAN-1" }));
    await journal.append(record({ issueKey: "KAN-2" }));

    await expect(journal.append(record({ issueKey: "KAN-3" }))).rejects.toThrow(
      /best-effort observed-count admission threshold/i
    );
    expect(await journal.scan("a".repeat(64))).toHaveLength(2);
  });

  it("quarantines corrupt and v1 entries while retaining valid v2 and v3 entries", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    const valid = await journal.append(record());
    const current = await journal.append({
      version: 3,
      scopeHash: "a".repeat(64),
      issueKey: "KAN-43",
      kind: "release",
      command: {
        commandId: randomUUID(),
        epoch: "11111111-1111-4111-8111-111111111111",
        leaseGeneration: 7,
        ownerId: randomUUID(),
      },
    });
    await writeFile(join(directory, `${randomUUID()}.json`), "not-json", { mode: 0o600 });
    await writeFile(
      join(directory, `${randomUUID()}.json`),
      JSON.stringify({ version: 1, issueKey: "KAN-OLD" }),
      { mode: 0o600 }
    );

    const entries = await journal.scan("a".repeat(64));
    expect(entries.map((entry) => entry.path).sort()).toEqual([valid.path, current.path].sort());
    expect(await readdir(join(directory, "quarantine"))).toHaveLength(2);
  });

  it("propagates transient read failures without moving a valid signal", async () => {
    const directory = await temporaryDirectory();
    const writer = new CaptureJournal({ directory });
    const signal = await writer.append(record());
    const originalBytes = await readFile(signal.path, "utf8");
    const readError = Object.assign(new Error("injected read failure"), { code: "EIO" });
    const reader = new CaptureJournal({
      directory,
      readFile: vi.fn().mockRejectedValue(readError),
    });

    await expect(reader.scan("a".repeat(64))).rejects.toBe(readError);
    expect(await readFile(signal.path, "utf8")).toBe(originalBytes);
    expect(await readdir(directory)).toContain(signal.fileName);
    await expect(readdir(join(directory, "quarantine"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("treats concurrent corrupt-source ENOENT as already quarantined", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    await writeFile(join(directory, `${randomUUID()}.json`), "{".repeat(512 * 1024), {
      mode: 0o600,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const scans = Array.from({ length: 24 }, () => journal.scan("a".repeat(64)));

    await expect(Promise.all(scans)).resolves.toHaveLength(24);
    expect(await readdir(join(directory, "quarantine"))).toHaveLength(1);
  });

  it("deletes only the exact acknowledged signal", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    const first = await journal.append(record({ issueKey: "KAN-1" }));
    const second = await journal.append(record({ issueKey: "KAN-1" }));

    await journal.remove(first);

    expect((await journal.scan("a".repeat(64))).map((entry) => entry.path)).toEqual([second.path]);
  });

  it("recognizes an existing close as stronger than release for the same fence", async () => {
    const directory = await temporaryDirectory();
    const journal = new CaptureJournal({ directory });
    const close = record({ kind: "close" });
    await journal.append(close);

    await expect(journal.hasClose(close.scopeHash, close.issueKey, close.command)).resolves.toBe(
      true
    );
    await expect(
      journal.hasClose(close.scopeHash, close.issueKey, { ...close.command, leaseGeneration: 8 })
    ).resolves.toBe(false);
  });
});
