/**
 * Property-based tests (fast-check) for pure logic in @kanon/web.
 *
 * Targets:
 *  1. aggregateIssuesFromQueries  — the KAN-90 cache-shape class
 *  2. issueKeys / cycleKeys       — query-key builder invariants
 *     (prefix hierarchy underpins the KAN-88 SSE-scoping fix)
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import {
  issueKeys,
  cycleKeys,
  commentKeys,
  memberKeys,
  roadmapKeys,
  notificationKeys,
} from "@/lib/query-keys";
import { aggregateIssuesFromQueries } from "@/lib/aggregate-issues";
import type { Issue } from "@/types/issue";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A minimal valid Issue — all required fields, realistic values. */
const issueArb: fc.Arbitrary<Issue> = fc.record({
  id: fc.uuid(),
  key: fc.stringMatching(/^[A-Z]{2,6}-\d{1,4}$/),
  title: fc.string({ minLength: 1, maxLength: 120 }),
  description: fc.option(fc.string(), { nil: null }),
  type: fc.constantFrom("feature", "bug", "task", "spike" as const),
  priority: fc.constantFrom("critical", "high", "medium", "low" as const),
  state: fc.constantFrom(
    "todo",
    "in_progress",
    "done",
    "review",
    "backlog",
  ),
  labels: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    maxLength: 5,
  }),
  assigneeId: fc.option(fc.uuid(), { nil: null }),
  assignee: fc.option(
    fc.record({ username: fc.string({ minLength: 1, maxLength: 30 }) }),
    { nil: null },
  ),
  parentId: fc.option(fc.uuid(), { nil: null }),
  groupKey: fc.option(fc.string({ minLength: 1, maxLength: 30 }), {
    nil: null,
  }),
  projectId: fc.uuid(),
  // noInvalidDate: fc.date() emits `new Date(NaN)` even with min/max bounds,
  // and Invalid Date throws RangeError on toISOString()
  createdAt: fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
    .map((d) => d.toISOString()),
  updatedAt: fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
    .map((d) => d.toISOString()),
});

/**
 * Arbitrary cache entry value — covers every shape the TanStack Query cache
 * could realistically contain when scoped to issueKeys.lists():
 *   - Issue[]         normal case
 *   - Issue           single object (the KAN-90 trigger)
 *   - null            in-flight / stale
 *   - undefined       never-fetched
 *   - GroupSummary[]  wrong-key bleed (defensive)
 *   - number / string pathological
 */
const cacheValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.array(issueArb, { maxLength: 10 }),             // Issue[] — normal
  issueArb,                                           // single Issue — KAN-90 trigger
  fc.constant(null),                                  // null
  fc.constant(undefined),                             // undefined
  fc.array(fc.record({ groupKey: fc.string(), count: fc.nat() }), { maxLength: 5 }), // wrong type
  fc.integer(),                                       // pathological scalar
  fc.string(),                                        // pathological scalar
);

/** A getQueriesData-style entries array: [QueryKey, data][] */
const queriesDataArb: fc.Arbitrary<[unknown, unknown][]> = fc.array(
  fc.tuple(fc.array(fc.string(), { maxLength: 4 }), cacheValueArb),
  { maxLength: 20 },
);

/** Non-empty printable string — for query key builder inputs. */
const keyStringArb = fc.string({ minLength: 1, maxLength: 40 }).filter(
  (s) => s.trim().length > 0,
);

// ---------------------------------------------------------------------------
// 1. aggregateIssuesFromQueries — cache-shape robustness (KAN-90 class)
// ---------------------------------------------------------------------------

describe("aggregateIssuesFromQueries — property tests", () => {
  it("never throws regardless of cache shape", () => {
    fc.assert(
      fc.property(queriesDataArb, (entries) => {
        // Must not throw for ANY input shape.
        let threw = false;
        try {
          aggregateIssuesFromQueries(entries);
        } catch {
          threw = true;
        }
        return !threw;
      }),
    );
  });

  it("always returns an array", () => {
    fc.assert(
      fc.property(queriesDataArb, (entries) => {
        const result = aggregateIssuesFromQueries(entries);
        return Array.isArray(result);
      }),
    );
  });

  it("result count equals the sum of items in Issue[] entries only", () => {
    fc.assert(
      fc.property(queriesDataArb, (entries) => {
        const expected = entries.reduce((sum, [, data]) => {
          return sum + (Array.isArray(data) ? data.length : 0);
        }, 0);
        const result = aggregateIssuesFromQueries(entries);
        return result.length === expected;
      }),
    );
  });

  it("a single-Issue object (KAN-90 trigger) is silently ignored, not spread-thrown", () => {
    fc.assert(
      fc.property(issueArb, fc.array(issueArb, { maxLength: 5 }), (singleIssue, listIssues) => {
        // One entry is a bare Issue object (not an array) — the exact KAN-90 shape.
        const entries: [unknown, unknown][] = [
          [["issues", "list", "KAN-90-project"], singleIssue],  // bare object — should be skipped
          [["issues", "list", "other-project"], listIssues],    // array — should be included
        ];
        const result = aggregateIssuesFromQueries(entries);
        // Should include exactly the listIssues contents, not the single issue.
        return result.length === listIssues.length;
      }),
    );
  });

  it("empty entries array returns empty array", () => {
    fc.assert(
      fc.property(fc.constant([] as [unknown, unknown][]), (entries) => {
        return aggregateIssuesFromQueries(entries).length === 0;
      }),
    );
  });

  it("all-null/undefined entries return empty array", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.array(fc.string(), { maxLength: 4 }),
            fc.oneof(fc.constant(null), fc.constant(undefined)),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (entries) => {
          const result = aggregateIssuesFromQueries(entries as [unknown, unknown][]);
          return result.length === 0;
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. issueKeys — query-key builder invariants
// ---------------------------------------------------------------------------

describe("issueKeys — property tests", () => {
  it("lists() is always a prefix of list(projectKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const lists = issueKeys.lists();
        const list = issueKeys.list(pk);
        return (
          list.length === lists.length + 1 &&
          lists.every((seg, i) => seg === list[i])
        );
      }),
    );
  });

  it("all is a prefix of every list(projectKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const all = issueKeys.all;
        const list = issueKeys.list(pk);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });

  it("all is a prefix of every detail(key)", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        const all = issueKeys.all;
        const detail = issueKeys.detail(k);
        return all.every((seg, i) => seg === detail[i]);
      }),
    );
  });

  it("list(key) builders are deterministic (same input → same output)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const a = issueKeys.list(pk);
        const b = issueKeys.list(pk);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
    );
  });

  it("list(A) !== list(B) for distinct project keys", () => {
    fc.assert(
      fc.property(
        keyStringArb,
        keyStringArb.filter((b) => b !== ""),
        (a, b) => {
          fc.pre(a !== b);
          return JSON.stringify(issueKeys.list(a)) !== JSON.stringify(issueKeys.list(b));
        },
      ),
    );
  });

  it("detail(A) !== detail(B) for distinct issue keys", () => {
    fc.assert(
      fc.property(keyStringArb, keyStringArb, (a, b) => {
        fc.pre(a !== b);
        return JSON.stringify(issueKeys.detail(a)) !== JSON.stringify(issueKeys.detail(b));
      }),
    );
  });

  it("list and detail keys are always distinct for the same input", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        return JSON.stringify(issueKeys.list(k)) !== JSON.stringify(issueKeys.detail(k));
      }),
    );
  });

  it("documents(key) is always nested under all (SSE invalidation contract)", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        const all = issueKeys.all;
        const docs = issueKeys.documents(k);
        return all.every((seg, i) => seg === docs[i]);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. cycleKeys — query-key builder invariants (KAN-88 SSE-scoping)
// ---------------------------------------------------------------------------

describe("cycleKeys — property tests", () => {
  it("lists() is always a prefix of list(projectKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const lists = cycleKeys.lists();
        const list = cycleKeys.list(pk);
        return (
          list.length === lists.length + 1 &&
          lists.every((seg, i) => seg === list[i])
        );
      }),
    );
  });

  it("all is a prefix of every list(projectKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const all = cycleKeys.all;
        const list = cycleKeys.list(pk);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });

  it("all is a prefix of every detail(cycleId)", () => {
    fc.assert(
      fc.property(keyStringArb, (id) => {
        const all = cycleKeys.all;
        const detail = cycleKeys.detail(id);
        return all.every((seg, i) => seg === detail[i]);
      }),
    );
  });

  it("list(A) !== list(B) for distinct project keys", () => {
    fc.assert(
      fc.property(keyStringArb, keyStringArb, (a, b) => {
        fc.pre(a !== b);
        return JSON.stringify(cycleKeys.list(a)) !== JSON.stringify(cycleKeys.list(b));
      }),
    );
  });

  it("list and detail keys are always distinct for the same input", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        return JSON.stringify(cycleKeys.list(k)) !== JSON.stringify(cycleKeys.detail(k));
      }),
    );
  });

  it("builders are deterministic (same input → same output)", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        return (
          JSON.stringify(cycleKeys.list(k)) === JSON.stringify(cycleKeys.list(k)) &&
          JSON.stringify(cycleKeys.detail(k)) === JSON.stringify(cycleKeys.detail(k))
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Other pure key factories — prefix invariants (spot-check)
// ---------------------------------------------------------------------------

describe("commentKeys / memberKeys / roadmapKeys / notificationKeys — prefix invariants", () => {
  it("commentKeys: all is a prefix of list(issueKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (k) => {
        const all = commentKeys.all;
        const list = commentKeys.list(k);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });

  it("memberKeys: all is a prefix of list(workspaceId)", () => {
    fc.assert(
      fc.property(keyStringArb, (id) => {
        const all = memberKeys.all;
        const list = memberKeys.list(id);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });

  it("roadmapKeys: all is a prefix of list(projectKey)", () => {
    fc.assert(
      fc.property(keyStringArb, (pk) => {
        const all = roadmapKeys.all;
        const list = roadmapKeys.list(pk);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });

  it("roadmapKeys: all is a prefix of detail(id)", () => {
    fc.assert(
      fc.property(keyStringArb, (id) => {
        const all = roadmapKeys.all;
        const detail = roadmapKeys.detail(id);
        return all.every((seg, i) => seg === detail[i]);
      }),
    );
  });

  it("notificationKeys: all is a prefix of list(workspaceId)", () => {
    fc.assert(
      fc.property(keyStringArb, (id) => {
        const all = notificationKeys.all;
        const list = notificationKeys.list(id);
        return all.every((seg, i) => seg === list[i]);
      }),
    );
  });
});
