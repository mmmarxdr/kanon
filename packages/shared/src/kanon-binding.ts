// ─── kanon-binding — .kanon file schema, walk-up resolver, and writer ─────────
//
// A `.kanon` file committed in the repository root binds the repo to a Kanon
// project. This module provides:
//
//   parseKanonConfig  — Zod-based schema validator (strict: no extra fields)
//   findKanonConfig   — walk-up resolver: cwd → repo root (stops at .git)
//   writeKanonConfig  — pure serialiser for writing a .kanon file
//
// Design decisions:
//   - Schema is STRICT: no engram fields, no credentials (design #2).
//   - Walk stops at the first directory that contains a `.git` entry (like git
//     itself). A `.kanon` above the `.git` boundary is NOT resolved.
//   - fs is injected via deps to keep this module pure and easily testable.
//   - This file is the canonical source. Packages that need it at runtime
//     (mcp, setup) receive a prebuild-copy so they stay self-contained at publish.

import { z } from "zod";
import * as nodePath from "node:path";

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * A valid `.kanon` binding. Exactly three non-empty string fields.
 * `.strict()` rejects extra keys (e.g. engram fields, credentials).
 */
export const KanonBindingSchema = z
  .object({
    projectKey: z.string().min(1, "projectKey must not be empty"),
    workspaceId: z.string().min(1, "workspaceId must not be empty"),
    apiUrl: z.string().min(1, "apiUrl must not be empty"),
  })
  .strict();

export type KanonBinding = z.infer<typeof KanonBindingSchema>;

// ─── Injected FS deps ────────────────────────────────────────────────────────

export interface KanonBindingFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate the raw content of a `.kanon` file.
 *
 * @throws ZodError with a clear message if the content is malformed or missing fields.
 * @throws SyntaxError if the content is not valid JSON.
 */
export function parseKanonConfig(raw: string): KanonBinding {
  const parsed: unknown = JSON.parse(raw); // throws SyntaxError on bad JSON
  return KanonBindingSchema.parse(parsed); // throws ZodError on schema failure
}

// ─── Walk-up resolver ────────────────────────────────────────────────────────

/**
 * Walk up from `startDir` toward the repo root, returning the nearest
 * ancestor's `.kanon` binding (parsed), or `null` if none is found.
 *
 * Boundary rule: the walk stops after inspecting the directory that contains a
 * `.git` entry — mirroring git's own discovery. A `.kanon` placed ABOVE a `.git`
 * directory is not resolved (avoids binding to an unrelated user-home `.kanon`).
 *
 * Algorithm per directory:
 *   1. If `.kanon` exists here → parse and return it.
 *   2. If `.git` exists here → stop (this is the repo root; .kanon must be here
 *      or not at all).
 *   3. Move to parent; if parent === current (filesystem root) → stop.
 *
 * @param startDir   Absolute path of the directory to start from (e.g. cwd).
 * @param deps       Injected fs helpers for testability.
 * @returns          Parsed KanonBinding, or null if not found within boundary.
 * @throws           If a `.kanon` file is found but its content is malformed.
 */
export function findKanonConfig(startDir: string, deps: KanonBindingFs): KanonBinding | null {
  let current = startDir;

  for (;;) {
    const kanonPath = nodePath.join(current, ".kanon");
    const gitPath = nodePath.join(current, ".git");

    // Check .kanon first — even at the .git boundary the repo root .kanon is valid.
    if (deps.existsSync(kanonPath)) {
      const raw = deps.readFileSync(kanonPath);
      return parseKanonConfig(raw); // throws on malformed content
    }

    // Hit the repo root boundary — stop without finding a .kanon.
    if (deps.existsSync(gitPath)) {
      return null;
    }

    // Move up.
    const parent = nodePath.dirname(current);
    if (parent === current) {
      // Reached the filesystem root without hitting .git — stop.
      return null;
    }
    current = parent;
  }
}

// ─── Writer ──────────────────────────────────────────────────────────────────

/**
 * Serialise a KanonBinding to a formatted JSON string suitable for writing
 * to a `.kanon` file. Only the three canonical fields are included.
 *
 * NOTE: This is a pure serialiser — callers are responsible for writing to disk.
 * A helper tool or CLI hook wires this to the filesystem (deferred to kanon-init
 * / `kanon link` command per task 3.4 design intent).
 */
export function writeKanonConfig(binding: KanonBinding): string {
  // Explicitly pick the three fields to prevent accidental extra keys.
  const clean: KanonBinding = {
    projectKey: binding.projectKey,
    workspaceId: binding.workspaceId,
    apiUrl: binding.apiUrl,
  };
  return JSON.stringify(clean, null, 2);
}
