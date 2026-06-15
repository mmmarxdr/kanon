/**
 * parseSearchTokens — pure function, no side effects.
 *
 * Parses a raw palette search string into { q, filters }.
 * Recognised prefixes: state:, type:, priority:, has:
 *
 * Validation rules:
 *  - state/type/priority values are validated against the shared enums.
 *    An invalid value causes the WHOLE token (e.g. "state:notastate") to
 *    fall through to q as free text — no throw.
 *  - has:adr|pdr|rfc|note  → filters.documentKind
 *  - has:doc|any|true       → filters.hasDocuments = true
 *  - has:<anything-else>    → falls through to q
 *  - Unknown prefix (e.g. foo:bar) → falls through to q
 *  - last-wins on repeated tokens of the same prefix
 *
 * setFilterToken — pure upsert/remove of a typed token in a raw string.
 * Used by chip controls to write through the raw input.
 */

import {
  issueStateSchema,
  issueTypeSchema,
  issuePrioritySchema,
  documentKindSchema,
  type IssueFilters,
} from "@kanon/shared";

export interface ParsedSearch {
  q: string;
  filters: IssueFilters;
}

const RECOGNISED_PREFIXES = new Set([
  "state",
  "type",
  "priority",
  "has",
] as const);

type RecognisedPrefix = "state" | "type" | "priority" | "has";

/** has: values that map to hasDocuments=true */
const HAS_DOCUMENTS_VALUES = new Set(["doc", "any", "true"]);

export function parseSearchTokens(raw: string): ParsedSearch {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const freeTextParts: string[] = [];
  const filters: IssueFilters = {};

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx <= 0) {
      // No colon or colon at start → free text
      freeTextParts.push(token);
      continue;
    }

    const prefix = token.slice(0, colonIdx);
    const value = token.slice(colonIdx + 1);

    if (!RECOGNISED_PREFIXES.has(prefix as RecognisedPrefix)) {
      freeTextParts.push(token);
      continue;
    }

    switch (prefix as RecognisedPrefix) {
      case "state": {
        const parsed = issueStateSchema.safeParse(value);
        if (parsed.success) {
          filters.state = parsed.data;
        } else {
          freeTextParts.push(token);
        }
        break;
      }
      case "type": {
        const parsed = issueTypeSchema.safeParse(value);
        if (parsed.success) {
          filters.type = parsed.data;
        } else {
          freeTextParts.push(token);
        }
        break;
      }
      case "priority": {
        const parsed = issuePrioritySchema.safeParse(value);
        if (parsed.success) {
          filters.priority = parsed.data;
        } else {
          freeTextParts.push(token);
        }
        break;
      }
      case "has": {
        if (HAS_DOCUMENTS_VALUES.has(value)) {
          filters.hasDocuments = true;
        } else {
          const parsed = documentKindSchema.safeParse(value);
          if (parsed.success) {
            filters.documentKind = parsed.data;
          } else {
            freeTextParts.push(token);
          }
        }
        break;
      }
    }
  }

  return {
    q: freeTextParts.join(" "),
    filters,
  };
}

/**
 * Upserts or removes a typed filter token in the raw palette search string.
 *
 * - If value is non-empty: replaces any existing "<prefix>:..." token with
 *   "<prefix>:<value>", or appends if not present.
 * - If value is undefined or empty string: removes the existing token entirely.
 *
 * The rest of the raw string (free-text parts) is preserved.
 */
export function setFilterToken(
  raw: string,
  prefix: RecognisedPrefix,
  value: string | undefined,
): string {
  const tokenPattern = new RegExp(`\\b${prefix}:[^\\s]*`, "g");
  const withoutExisting = raw.replace(tokenPattern, "").replace(/\s+/g, " ").trim();

  if (!value) {
    return withoutExisting;
  }

  return withoutExisting
    ? `${withoutExisting} ${prefix}:${value}`
    : `${prefix}:${value}`;
}
