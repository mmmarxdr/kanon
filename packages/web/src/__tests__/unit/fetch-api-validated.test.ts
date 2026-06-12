/**
 * TDD tests for fetchApiValidated — the Zod-parsing fetch boundary.
 *
 * RED phase: these tests fail until fetchApiValidated and ApiValidationError
 * are added to @/lib/api-client.
 *
 * Acceptance criteria:
 *  (a) Valid response → parsed data returned with correct shape
 *  (b) Malformed response → throws ApiValidationError (NOT a raw TypeError)
 *  (c) ApiValidationError carries a human-readable message and the ZodError
 *
 * Note: @kanon/web does not have zod as a direct dependency.
 * We test against the real shared schemas (issueSchema, groupSummarySchema)
 * which are re-exported from @kanon/shared.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  issueSchema,
  groupSummaryListSchema,
} from "@kanon/shared";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function importModule() {
  const mod = await import("@/lib/api-client");
  return mod;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ISSUE = {
  id: "u-1",
  key: "KAN-1",
  title: "Test issue",
  type: "task",
  priority: "medium",
  state: "todo",
  labels: [],
  projectId: "proj-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const VALID_GROUPS = [
  {
    groupKey: "g-1",
    count: 2,
    latestState: "in_progress",
    title: "Group A",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("fetchApiValidated", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── (a) Valid response ────────────────────────────────────────────────────

  it("returns parsed data when the response matches the schema", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(VALID_ISSUE));

    const { fetchApiValidated } = await importModule();
    const result = await fetchApiValidated("/api/test", issueSchema);

    expect(result.id).toBe("u-1");
    expect(result.key).toBe("KAN-1");
    expect(result.state).toBe("todo");
  });

  it("strips extra unknown fields from the response (Zod strip mode)", async () => {
    const withExtra = { ...VALID_ISSUE, extraNoise: "should-be-stripped" };

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(withExtra));

    const { fetchApiValidated } = await importModule();
    const result = await fetchApiValidated("/api/test", issueSchema) as Record<string, unknown>;

    expect(result["extraNoise"]).toBeUndefined();
    expect(result["id"]).toBe("u-1");
  });

  it("works with array schemas — valid array returns typed array", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(VALID_GROUPS));

    const { fetchApiValidated } = await importModule();
    const result = await fetchApiValidated("/api/groups", groupSummaryListSchema);

    expect(result).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result[0]!.groupKey).toBe("g-1");
    expect(result[0]!.count).toBe(2);
  });

  // ── (b) Invalid / malformed response → ApiValidationError ────────────────

  it("throws ApiValidationError (not TypeError) when required fields are missing", async () => {
    const malformed = { id: "u-3" }; // missing all required fields

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(malformed));

    const { fetchApiValidated, ApiValidationError } = await importModule();

    await expect(
      fetchApiValidated("/api/test", issueSchema),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it("throws ApiValidationError when enum field has invalid value", async () => {
    const badEnum = {
      ...VALID_ISSUE,
      state: "invalid_state", // not in IssueState enum
    };

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(badEnum));

    const { fetchApiValidated, ApiValidationError } = await importModule();

    await expect(
      fetchApiValidated("/api/test", issueSchema),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it("throws ApiValidationError with a message containing the endpoint path", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ wrong: "shape" }));

    const { fetchApiValidated, ApiValidationError } = await importModule();

    let caught: unknown;
    try {
      await fetchApiValidated("/api/issues/KAN-1", issueSchema);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiValidationError);
    const err = caught as InstanceType<typeof ApiValidationError>;
    expect(err.message).toContain("/api/issues/KAN-1");
  });

  it("exposes the ZodError as .cause so callers can inspect validation issues", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ bad: "data" }));

    const { fetchApiValidated, ApiValidationError } = await importModule();

    let caught: unknown;
    try {
      await fetchApiValidated("/api/test", issueSchema);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiValidationError);
    const err = caught as InstanceType<typeof ApiValidationError>;
    expect(err.cause).toBeDefined();
    // ZodError has .issues array
    expect(
      (err.cause as { issues?: unknown }).issues,
    ).toBeInstanceOf(Array);
  });

  // ── (c) ApiValidationError is NOT an ApiError ─────────────────────────────

  it("ApiValidationError is a distinct class from ApiError", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ bad: "shape" }));

    const { fetchApiValidated, ApiValidationError, ApiError } =
      await importModule();

    let caught: unknown;
    try {
      await fetchApiValidated("/api/test", issueSchema);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiValidationError);
    expect(caught).not.toBeInstanceOf(ApiError);
  });

  // ── HTTP errors still propagate as ApiError ───────────────────────────────

  it("still throws ApiError for non-2xx HTTP responses (not ApiValidationError)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "missing" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { fetchApiValidated, ApiError, ApiValidationError } =
      await importModule();

    let caught: unknown;
    try {
      await fetchApiValidated("/api/missing", issueSchema);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).not.toBeInstanceOf(ApiValidationError);
    expect((caught as InstanceType<typeof ApiError>).status).toBe(404);
  });

  it("works with array schemas — malformed item in array throws ApiValidationError", async () => {
    const bad = [{ groupKey: "g-1" }]; // missing required fields

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(bad));

    const { fetchApiValidated, ApiValidationError } = await importModule();

    await expect(
      fetchApiValidated("/api/groups", groupSummaryListSchema),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});
