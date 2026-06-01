// ─── errorResult — 403 FORBIDDEN surfacing ───────────────────────────────────
//
// Confirms that errorResult() maps a KanonApiError(403, "FORBIDDEN", ...) into
// the isError:true shape the MCP layer promises (KAN-20 contract).

import { describe, it, expect } from "vitest";
import { errorResult } from "./errors.js";
import { KanonApiError } from "./kanon-client.js";

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
