// ─── errorResult — 403 FORBIDDEN surfacing ───────────────────────────────────
//
// Confirms that errorResult() maps a KanonApiError(403, "FORBIDDEN", ...) into
// the isError:true shape the MCP layer promises (KAN-20 contract).

import { describe, it, expect } from "vitest";
import { errorResult, triageDataResult } from "./errors.js";
import { KanonApiError } from "./kanon-client.js";
import { TRIAGE_MCP_CONTRACT_VERSION } from "./types.js";

describe("errorResult — 403 FORBIDDEN", () => {
  it("maps KanonApiError(403) to isError:true with code FORBIDDEN", () => {
    const err = new KanonApiError(403, "FORBIDDEN", "You are not assigned to this project");
    const result = errorResult(err);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.code).toBe("FORBIDDEN");
    expect(parsed.error).toContain("403");
  });
});

describe("errorResult — triage semantic mapping", () => {
  it("preserves category, retry, correlation, and MCP contract version", () => {
    const err = new KanonApiError(
      409,
      "SOURCE_CONFLICT",
      "source changed",
      undefined,
      {
        category: "source_conflict",
        retry: "rerun_preview",
        correlationId: "550e8400-e29b-41d4-a716-446655440000",
        apiContractVersion: "triage-api.v1",
        provenance: { sourceVersion: "v1" },
      },
    );
    const parsed = JSON.parse(errorResult(err).content[0]!.text);
    expect(parsed.category).toBe("source_conflict");
    expect(parsed.retry).toBe("rerun_preview");
    expect(parsed.correlationId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed.mcpContractVersion).toBe(TRIAGE_MCP_CONTRACT_VERSION);
    expect(parsed.provenance).toEqual({ sourceVersion: "v1" });
  });

  it("does not invent semantic fields for plain API errors", () => {
    const parsed = JSON.parse(
      errorResult(new KanonApiError(500, "API_ERROR", "boom")).content[0]!.text,
    );
    expect(parsed.category).toBeUndefined();
    expect(parsed.retry).toBeUndefined();
  });
});

describe("triageDataResult", () => {
  it("adds mcp contract/version without dropping API fields", () => {
    const parsed = JSON.parse(
      triageDataResult(
        { lifecycle: "pending", correlationId: "c1" },
        "c2",
      ).content[0]!.text,
    );
    expect(parsed.lifecycle).toBe("pending");
    expect(parsed.correlationId).toBe("c1");
    expect(parsed.mcpContractVersion).toBe(TRIAGE_MCP_CONTRACT_VERSION);
    expect(parsed.mcpVersion).toBeTypeOf("string");
  });
});
