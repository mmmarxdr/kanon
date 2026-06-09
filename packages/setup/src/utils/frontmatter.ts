// ─── YAML Frontmatter Parser ────────────────────────────────────────────────
//
// Minimal YAML frontmatter parser scoped to the subset of YAML used by the
// shipped Kanon skill assets: scalar values, inline flow lists
// ([a, b, c]), and block sequence lists (- item, possibly indented).
//
// Why a hand-rolled parser instead of pulling js-yaml?
// - The asset set has <10 distinct keys and only scalar/sequence shapes.
// - A 60-line parser with no transitive deps is auditable and small.
// - OpenCode-compat tests assert behavior; we don't need full YAML 1.2.
//
// API:
//   parseSkillFrontmatter(markdown): Record<string, unknown>
//   parseFrontmatter(markdown):       { body: string; data: Record<string,unknown> }
//   stripDisallowedKeys(data, allowed): Record<string, unknown>
//
// Errors are intentionally concise; callers can add file context if needed.

export interface FrontmatterResult {
  body: string;
  data: Record<string, unknown>;
}

const FENCE = "---";

/**
 * Split a markdown document into its YAML frontmatter (between `---` fences)
 * and the remaining body. If no fences are present, returns an empty data
 * object and the original text as body.
 */
export function parseFrontmatter(markdown: string): FrontmatterResult {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== FENCE) {
    return { body: markdown, data: {} };
  }

  // Find the closing fence on its own line. We require the closing fence to
  // start at column 0 (no leading whitespace) — this matches every shipped
  // asset and avoids mis-detecting indented `---` inside body content.
  // First line is the opening `---`; skip it.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error("Unterminated YAML frontmatter (no closing `---` found)");
  }

  const yamlBlock = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n");
  const data = parseYamlBlock(yamlBlock);
  return { body, data };
}

/**
 * Convenience: parse a markdown document and return only the frontmatter
 * data object. Throws on unterminated fences; returns {} when no fence.
 */
export function parseSkillFrontmatter(markdown: string): Record<string, unknown> {
  return parseFrontmatter(markdown).data;
}

/**
 * Return a copy of `data` with any key not in `allowed` removed.
 * Useful for normalizing older Claude-Code-style skill files down to the
 * OpenCode-compatible base key set.
 */
export function stripDisallowedKeys(
  data: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

// ─── Internal YAML subset parser ────────────────────────────────────────────

/**
 * Parse a YAML block into a plain object. Supports:
 * - top-level `key: scalar` (strings; bare/number/bool/null)
 * - top-level `key: [a, b, c]` flow list
 * - top-level `key:` followed by a `- item` block sequence (one level deep)
 *
 * Deliberately does NOT support nested mappings, anchors, multi-line
 * scalars, or block scalars. The shipped skill frontmatter uses none of
 * those, and adding them is out of PR 1 scope.
 */
function parseYamlBlock(block: string): Record<string, unknown> {
  const lines = block.split(/\r?\n/);
  const result: Record<string, unknown> = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    // Skip blanks and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Must be `key: <something>` at column 0
    const m = /^([A-Za-z_][A-Za-z0-9_\-]*):\s*(.*)$/.exec(line);
    if (!m) {
      // Unknown shape — skip defensively to keep the parser permissive.
      // The test suite asserts the shape is well-known for shipped assets.
      i++;
      continue;
    }

    const key = m[1];
    const rest = m[2];
    if (key === undefined || rest === undefined) {
      i++;
      continue;
    }

    if (rest === "") {
      // Possibly a block sequence on the following lines
      const seq: unknown[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next === undefined) break;
        const itemMatch = /^\s+-\s+(.*)$/.exec(next);
        if (!itemMatch) break;
        const item = itemMatch[1];
        if (item === undefined) break;
        seq.push(parseScalar(item.trim()));
        i++;
      }
      result[key] = seq;
      continue;
    }

    // Inline flow list `[a, b, c]`
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      const items = inner === "" ? [] : splitFlowList(inner).map((s) => parseScalar(s));
      result[key] = items;
      i++;
      continue;
    }

    // Scalar value
    result[key] = parseScalar(rest);
    i++;
  }

  return result;
}

function splitFlowList(inner: string): string[] {
  // Split on top-level commas, respecting balanced brackets/quotes.
  const out: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = "";
  for (const ch of inner) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        out.push(buf.trim());
        buf = "";
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim() !== "") out.push(buf.trim());
  return out;
}

function parseScalar(raw: string): string | number | boolean | null {
  const s = raw.trim();
  // Strip surrounding quotes if present
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === "" || s === "~" || s.toLowerCase() === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}
