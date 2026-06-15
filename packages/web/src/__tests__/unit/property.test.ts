/**
 * Property-based tests (fast-check) for pure logic in @kanon/web.
 *
 * Targets:
 *  1. issueKeys / cycleKeys — query-key builder invariants
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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty printable string — for query key builder inputs. */
const keyStringArb = fc.string({ minLength: 1, maxLength: 40 }).filter(
  (s) => s.trim().length > 0,
);

// ---------------------------------------------------------------------------
// 1. issueKeys — query-key builder invariants
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
