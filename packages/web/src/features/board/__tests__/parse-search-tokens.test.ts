/**
 * TDD tests for parseSearchTokens and setFilterToken (RED phase).
 *
 * parseSearchTokens: raw input string → { q, filters }
 * setFilterToken: upsert/remove a typed token in the raw string
 *
 * Recognised prefixes: state:, type:, priority:, has:
 * Invalid enum values → fall through to q as free text
 * has:adr|pdr|rfc|note → filters.documentKind
 * has:doc|any|true     → filters.hasDocuments = true
 */

import { describe, it, expect } from "vitest";
import {
  parseSearchTokens,
  setFilterToken,
} from "@/features/board/parse-search-tokens";

describe("parseSearchTokens", () => {
  it("returns empty q and empty filters for empty string", () => {
    const result = parseSearchTokens("");
    expect(result.q).toBe("");
    expect(result.filters).toEqual({});
  });

  it("returns plain text as q when no tokens present", () => {
    const result = parseSearchTokens("auth module");
    expect(result.q).toBe("auth module");
    expect(result.filters).toEqual({});
  });

  it("parses state token (valid value)", () => {
    const result = parseSearchTokens("state:done");
    expect(result.filters.state).toBe("done");
    expect(result.q).toBe("");
  });

  it("parses type token (valid value)", () => {
    const result = parseSearchTokens("type:bug");
    expect(result.filters.type).toBe("bug");
    expect(result.q).toBe("");
  });

  it("parses priority token (valid value)", () => {
    const result = parseSearchTokens("priority:high");
    expect(result.filters.priority).toBe("high");
    expect(result.q).toBe("");
  });

  it("treats invalid state value as free text", () => {
    const result = parseSearchTokens("state:notastate");
    expect(result.filters.state).toBeUndefined();
    expect(result.q).toBe("state:notastate");
  });

  it("treats invalid type value as free text", () => {
    const result = parseSearchTokens("type:unknown");
    expect(result.filters.type).toBeUndefined();
    expect(result.q).toBe("type:unknown");
  });

  it("treats invalid priority value as free text", () => {
    const result = parseSearchTokens("priority:extreme");
    expect(result.filters.priority).toBeUndefined();
    expect(result.q).toBe("priority:extreme");
  });

  it("has:adr sets documentKind filter", () => {
    const result = parseSearchTokens("has:adr");
    expect(result.filters.documentKind).toBe("adr");
    expect(result.filters.hasDocuments).toBeUndefined();
    expect(result.q).toBe("");
  });

  it("has:pdr sets documentKind filter", () => {
    const result = parseSearchTokens("has:pdr");
    expect(result.filters.documentKind).toBe("pdr");
  });

  it("has:rfc sets documentKind filter", () => {
    const result = parseSearchTokens("has:rfc");
    expect(result.filters.documentKind).toBe("rfc");
  });

  it("has:note sets documentKind filter", () => {
    const result = parseSearchTokens("has:note");
    expect(result.filters.documentKind).toBe("note");
  });

  it("has:doc sets hasDocuments=true", () => {
    const result = parseSearchTokens("has:doc");
    expect(result.filters.hasDocuments).toBe(true);
    expect(result.filters.documentKind).toBeUndefined();
    expect(result.q).toBe("");
  });

  it("has:any sets hasDocuments=true", () => {
    const result = parseSearchTokens("has:any");
    expect(result.filters.hasDocuments).toBe(true);
  });

  it("has:true sets hasDocuments=true", () => {
    const result = parseSearchTokens("has:true");
    expect(result.filters.hasDocuments).toBe(true);
  });

  it("has:unknown treats entire token as free text", () => {
    const result = parseSearchTokens("has:unknown");
    expect(result.filters.documentKind).toBeUndefined();
    expect(result.filters.hasDocuments).toBeUndefined();
    expect(result.q).toBe("has:unknown");
  });

  it("unknown prefix (foo:bar) is treated as free text", () => {
    const result = parseSearchTokens("foo:bar");
    expect(result.q).toBe("foo:bar");
    expect(result.filters).toEqual({});
  });

  it("leftover text after token extraction becomes q", () => {
    const result = parseSearchTokens("state:in_progress auth module");
    expect(result.filters.state).toBe("in_progress");
    expect(result.q).toBe("auth module");
  });

  it("multiple valid tokens are all captured", () => {
    const result = parseSearchTokens("state:done type:bug priority:high");
    expect(result.filters.state).toBe("done");
    expect(result.filters.type).toBe("bug");
    expect(result.filters.priority).toBe("high");
    expect(result.q).toBe("");
  });

  it("mixed valid tokens and free text", () => {
    const result = parseSearchTokens("state:todo auth endpoint");
    expect(result.filters.state).toBe("todo");
    expect(result.q).toBe("auth endpoint");
  });

  it("last-wins on repeated state token", () => {
    const result = parseSearchTokens("state:todo state:done");
    expect(result.filters.state).toBe("done");
    expect(result.q).toBe("");
  });

  it("invalid token in the middle of valid tokens falls through to q", () => {
    const result = parseSearchTokens("state:done foo:bar type:bug");
    expect(result.filters.state).toBe("done");
    expect(result.filters.type).toBe("bug");
    expect(result.q).toBe("foo:bar");
  });

  it("multiple words with no tokens go entirely to q", () => {
    const result = parseSearchTokens("auth api gateway");
    expect(result.q).toBe("auth api gateway");
    expect(result.filters).toEqual({});
  });

  it("whitespace-only string returns empty q and no filters", () => {
    const result = parseSearchTokens("   ");
    expect(result.q).toBe("");
    expect(result.filters).toEqual({});
  });
});

describe("setFilterToken", () => {
  it("adds a new token when the prefix is not present", () => {
    const result = setFilterToken("auth module", "state", "done");
    expect(result).toContain("state:done");
    expect(result).toContain("auth module");
  });

  it("replaces an existing token with the same prefix", () => {
    const result = setFilterToken("state:todo auth", "state", "done");
    expect(result).toContain("state:done");
    expect(result).not.toContain("state:todo");
  });

  it("removes the token when value is undefined", () => {
    const result = setFilterToken("state:todo auth", "state", undefined);
    expect(result).not.toContain("state:");
    expect(result).toContain("auth");
  });

  it("removes the token when value is empty string", () => {
    const result = setFilterToken("state:todo auth", "state", "");
    expect(result).not.toContain("state:");
  });

  it("does not affect other tokens when replacing one", () => {
    const result = setFilterToken("state:todo type:bug", "state", "done");
    expect(result).toContain("state:done");
    expect(result).toContain("type:bug");
  });

  it("returns trimmed result", () => {
    const result = setFilterToken("", "state", "done");
    expect(result.trim()).toBe(result);
  });
});
