import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  workCaptureCommandSchema,
  workCaptureOwnerCommandSchema,
  type WorkCaptureCommand,
} from "./work-capture.js";

/**
 * Best-effort threshold based on the per-scope entry count observed before append.
 * Lock-free concurrent writers may cross it; every admitted signal remains immutable.
 */
export const CAPTURE_SIGNAL_ADMISSION_THRESHOLD_PER_SCOPE = 256;

const legacyCaptureJournalRecordSchema = z
  .object({
    version: z.literal(2),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    issueKey: z.string().min(1),
    kind: z.enum(["activity", "release", "close"]),
    command: workCaptureCommandSchema,
  })
  .strict();

const ownerCaptureJournalRecordSchema = z
  .object({
    version: z.literal(3),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    issueKey: z.string().min(1),
    kind: z.enum(["activity", "release", "close"]),
    command: workCaptureOwnerCommandSchema,
  })
  .strict();

const captureJournalRecordSchema = z.discriminatedUnion("version", [
  legacyCaptureJournalRecordSchema,
  ownerCaptureJournalRecordSchema,
]);

export type CaptureJournalRecord = z.infer<typeof captureJournalRecordSchema>;
export type CaptureJournalKind = CaptureJournalRecord["kind"];

export interface CaptureJournalEntry {
  fileName: string;
  path: string;
  record: CaptureJournalRecord;
}

type ReadTextFile = (path: string, encoding: BufferEncoding) => Promise<string>;

export function captureScopeHash(apiUrl: string, principalId: string, workspaceId: string): string {
  const canonicalApiUrl = apiUrl.replace(/\/+$/, "");
  return createHash("sha256")
    .update(`${canonicalApiUrl}\0${principalId}\0${workspaceId}`)
    .digest("hex");
}

export function resolveCaptureJournalDirectory(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir()
): string {
  const override = env["KANON_STATE_DIR"];
  if (override) {
    if (!isAbsolute(override)) throw new Error("KANON_STATE_DIR must be an absolute path");
    return override;
  }
  return join(home, ".kanon", "state", "work-capture-journal-v2.d");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class CaptureJournal {
  readonly directory: string;
  private readonly admissionThresholdPerScope: number;
  private readonly readFile: ReadTextFile;

  constructor(
    options: {
      directory?: string;
      admissionThresholdPerScope?: number;
      readFile?: ReadTextFile;
    } = {}
  ) {
    this.directory = options.directory ?? resolveCaptureJournalDirectory();
    this.admissionThresholdPerScope =
      options.admissionThresholdPerScope ?? CAPTURE_SIGNAL_ADMISSION_THRESHOLD_PER_SCOPE;
    this.readFile = options.readFile ?? ((path, encoding) => readFile(path, encoding));
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }

  async append(record: CaptureJournalRecord): Promise<CaptureJournalEntry> {
    const parsed = captureJournalRecordSchema.parse(record);
    await this.ensureDirectory();
    const existing = await this.scan(parsed.scopeHash);
    if (existing.length >= this.admissionThresholdPerScope) {
      throw new Error(
        `Work-capture journal best-effort observed-count admission threshold reached for scope ${parsed.scopeHash}`
      );
    }

    const fileName = `${randomUUID()}.json`;
    const finalPath = join(this.directory, fileName);
    const temporaryPath = join(this.directory, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(parsed));
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, finalPath);
      await syncDirectory(this.directory);
      return { fileName, path: finalPath, record: parsed };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async scan(scopeHash: string): Promise<CaptureJournalEntry[]> {
    await this.ensureDirectory();
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
    const entries: CaptureJournalEntry[] = [];
    for (const fileName of names) {
      const path = join(this.directory, fileName);
      const bytes = await this.readFile(path, "utf8");
      try {
        const parsed = captureJournalRecordSchema.parse(JSON.parse(bytes));
        if (parsed.scopeHash === scopeHash) entries.push({ fileName, path, record: parsed });
      } catch (error) {
        await this.quarantine(fileName, error);
      }
    }
    return entries;
  }

  private async quarantine(fileName: string, error: unknown): Promise<void> {
    const quarantineDirectory = join(this.directory, "quarantine");
    await mkdir(quarantineDirectory, { recursive: true, mode: 0o700 });
    await chmod(quarantineDirectory, 0o700);
    const source = join(this.directory, fileName);
    const target = join(quarantineDirectory, `${fileName}.${randomUUID()}.invalid`);
    try {
      await rename(source, target);
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === "ENOENT" && fsError.path === source) return;
      throw error;
    }
    await syncDirectory(quarantineDirectory);
    await syncDirectory(this.directory);
    console.error(`[capture-journal] Quarantined invalid entry ${fileName}:`, error);
  }

  async remove(entry: CaptureJournalEntry): Promise<void> {
    try {
      await unlink(entry.path);
      await syncDirectory(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async hasClose(
    scopeHash: string,
    issueKey: string,
    command: Pick<WorkCaptureCommand, "epoch" | "leaseGeneration">
  ): Promise<boolean> {
    const entries = await this.scan(scopeHash);
    return entries.some(
      (entry) =>
        entry.record.issueKey === issueKey &&
        entry.record.kind === "close" &&
        entry.record.command.epoch === command.epoch &&
        entry.record.command.leaseGeneration === command.leaseGeneration
    );
  }
}
