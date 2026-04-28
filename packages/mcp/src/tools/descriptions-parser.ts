/**
 * descriptions-parser.ts
 *
 * Parses `server.tool(name, description, ...)` calls from source files.
 * Handles:
 *  - Double-quoted string descriptions (with inner backticks/single-quotes)
 *  - Backtick-delimited template literals (no interpolation — treated as raw text)
 *  - Array-of-strings + .join("...") pattern (concatenates with join separator)
 */

import { readFileSync } from "fs";

export interface ToolDescription {
  toolName: string;
  description: string;
  byteLength: number;
  filePath: string;
}

/**
 * Extract the string value starting at `pos` in `src`.
 * Supports: `"..."`, `'...'`, `` `...` `` with escape sequences.
 * Returns { value, end } where `end` is the index after the closing quote.
 */
function extractString(src: string, pos: number): { value: string; end: number } | null {
  const openChar = src[pos];
  if (openChar !== '"' && openChar !== "'" && openChar !== "`") return null;

  let value = "";
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      // Escape sequence — take the next char literally (simplified)
      const next = src[i + 1] ?? "";
      switch (next) {
        case "n": value += "\n"; break;
        case "t": value += "\t"; break;
        case "r": value += "\r"; break;
        default: value += next;
      }
      i += 2;
    } else if (ch === openChar) {
      return { value, end: i + 1 };
    } else {
      value += ch;
      i++;
    }
  }
  return null; // unterminated string
}

/**
 * Skip whitespace and comments from `pos`.
 */
function skipWS(src: string, pos: number): number {
  while (pos < src.length) {
    // Skip whitespace
    if (/\s/.test(src[pos]!)) { pos++; continue; }
    // Skip line comment
    if (src.startsWith("//", pos)) {
      while (pos < src.length && src[pos] !== "\n") pos++;
      continue;
    }
    // Skip block comment
    if (src.startsWith("/*", pos)) {
      const end = src.indexOf("*/", pos + 2);
      pos = end === -1 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return pos;
}

/**
 * Try to parse an array-of-strings joined with `.join(...)` starting at `pos`.
 * Pattern: `[` string, string, ... `]` `.join(` sep `)`.
 * Returns { value, end } or null if not matched.
 */
function tryParseArrayJoin(src: string, pos: number): { value: string; end: number } | null {
  if (src[pos] !== "[") return null;

  let i = pos + 1;
  const parts: string[] = [];

  // Collect strings in the array
  while (i < src.length) {
    i = skipWS(src, i);
    if (src[i] === "]") { i++; break; }

    const strResult = extractString(src, i);
    if (!strResult) return null; // unexpected content
    parts.push(strResult.value);
    i = strResult.end;

    i = skipWS(src, i);
    if (src[i] === ",") i++;
    else if (src[i] === "]") { i++; break; }
    else return null;
  }

  // Expect `.join(`
  i = skipWS(src, i);
  if (!src.startsWith(".join(", i)) return null;
  i += 6; // skip `.join(`

  i = skipWS(src, i);
  const sepResult = extractString(src, i);
  if (!sepResult) return null;
  i = sepResult.end;

  i = skipWS(src, i);
  if (src[i] !== ")") return null;
  i++;

  return { value: parts.join(sepResult.value), end: i };
}

/**
 * Parse all `server.tool(name, description, ...)` calls from a source file.
 */
export function parseToolDescriptions(filePath: string): ToolDescription[] {
  const src = readFileSync(filePath, "utf8");
  const results: ToolDescription[] = [];

  const marker = "server.tool(";
  let searchFrom = 0;

  while (true) {
    const idx = src.indexOf(marker, searchFrom);
    if (idx === -1) break;

    let pos = idx + marker.length;
    pos = skipWS(src, pos);

    // Parse tool name
    const nameResult = extractString(src, pos);
    if (!nameResult) { searchFrom = idx + 1; continue; }
    const toolName = nameResult.value;
    pos = nameResult.end;

    pos = skipWS(src, pos);
    if (src[pos] !== ",") { searchFrom = idx + 1; continue; }
    pos++;
    pos = skipWS(src, pos);

    // Parse description: either array.join or plain string
    let description: string;
    let descEnd: number;

    const arrayResult = tryParseArrayJoin(src, pos);
    if (arrayResult) {
      description = arrayResult.value;
      descEnd = arrayResult.end;
    } else {
      const strResult = extractString(src, pos);
      if (!strResult) { searchFrom = idx + 1; continue; }
      description = strResult.value;
      descEnd = strResult.end;
    }

    results.push({
      toolName,
      description,
      byteLength: Buffer.byteLength(description, "utf8"),
      filePath,
    });

    searchFrom = descEnd;
  }

  return results;
}

/**
 * Parse all tool descriptions from multiple files.
 */
export function parseAllToolDescriptions(filePaths: string[]): ToolDescription[] {
  return filePaths.flatMap(parseToolDescriptions);
}
