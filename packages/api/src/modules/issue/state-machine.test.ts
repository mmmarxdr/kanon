import { describe, it, expect } from "vitest";
import { validateTransition } from "./state-machine.js";
import { ORDERED_STATES } from "../../shared/constants.js";
import type { IssueState } from "@prisma/client";

describe("validateTransition", () => {
  // ── Forward transitions ──────────────────────────────────────────────

  describe("forward transitions", () => {
    it("allows single-step forward (backlog -> explore)", () => {
      const result = validateTransition("backlog", "explore");
      expect(result).toEqual({ allowed: true, isRegression: false });
    });

    it("allows multi-step forward (backlog -> apply)", () => {
      const result = validateTransition("backlog", "apply");
      expect(result).toEqual({ allowed: true, isRegression: false });
    });

    it("allows forward to archived (verify -> archived)", () => {
      const result = validateTransition("verify", "archived");
      expect(result).toEqual({ allowed: true, isRegression: false });
    });

    it("allows all consecutive forward transitions", () => {
      for (let i = 0; i < ORDERED_STATES.length - 1; i++) {
        const from = ORDERED_STATES[i] as IssueState;
        const to = ORDERED_STATES[i + 1] as IssueState;
        const result = validateTransition(from, to);
        expect(result).toEqual({ allowed: true, isRegression: false });
      }
    });
  });

  // ── Backward transitions (regression) ────────────────────────────────

  describe("backward transitions (regression)", () => {
    it("allows backward and marks regression (apply -> backlog)", () => {
      const result = validateTransition("apply", "backlog");
      expect(result).toEqual({ allowed: true, isRegression: true });
    });

    it("allows single-step backward with regression (explore -> backlog)", () => {
      const result = validateTransition("explore", "backlog");
      expect(result).toEqual({ allowed: true, isRegression: true });
    });

    it("allows multi-step backward with regression (verify -> design)", () => {
      const result = validateTransition("verify", "design");
      expect(result).toEqual({ allowed: true, isRegression: true });
    });

    it("marks all backward transitions as regression", () => {
      for (let i = 1; i < ORDERED_STATES.length; i++) {
        const from = ORDERED_STATES[i] as IssueState;
        const to = ORDERED_STATES[0] as IssueState;
        const result = validateTransition(from, to);
        expect(result).toEqual({ allowed: true, isRegression: true });
      }
    });
  });

  // ── Archived reopen ──────────────────────────────────────────────────

  describe("archived reopen", () => {
    it("allows reopen from archived to backlog (regression)", () => {
      const result = validateTransition("archived", "backlog");
      expect(result).toEqual({ allowed: true, isRegression: true });
    });

    it("allows reopen from archived to any non-archived state", () => {
      const nonArchivedStates = ORDERED_STATES.filter((s) => s !== "archived");
      for (const to of nonArchivedStates) {
        const result = validateTransition("archived", to as IssueState);
        expect(result).toEqual({ allowed: true, isRegression: true });
      }
    });
  });

  // ── Same state (not allowed) ─────────────────────────────────────────

  describe("same state", () => {
    it("rejects same-state transition", () => {
      const result = validateTransition("backlog", "backlog");
      expect(result).toEqual({
        allowed: false,
        reason: 'Issue is already in state "backlog"',
      });
    });

    it("rejects same-state for every state", () => {
      for (const state of ORDERED_STATES) {
        const result = validateTransition(state as IssueState, state as IssueState);
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.reason).toContain(state);
        }
      }
    });
  });

  // ── Invalid states ───────────────────────────────────────────────────

  describe("invalid states", () => {
    it("rejects invalid 'from' state", () => {
      const result = validateTransition("invalid" as IssueState, "backlog");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain("Invalid state");
      }
    });

    it("rejects invalid 'to' state", () => {
      const result = validateTransition("backlog", "invalid" as IssueState);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain("Invalid state");
      }
    });
  });

  // ── Skip transitions ────────────────────────────────────────────────

  describe("skip transitions", () => {
    it("allows skipping multiple states forward (backlog -> verify)", () => {
      const result = validateTransition("backlog", "verify");
      expect(result).toEqual({ allowed: true, isRegression: false });
    });

    it("allows skipping multiple states backward (archived -> explore)", () => {
      const result = validateTransition("archived", "explore");
      expect(result).toEqual({ allowed: true, isRegression: true });
    });

    it("allows skipping to archived from any state", () => {
      const nonArchivedStates = ORDERED_STATES.filter((s) => s !== "archived");
      for (const from of nonArchivedStates) {
        const result = validateTransition(from as IssueState, "archived");
        expect(result).toEqual({ allowed: true, isRegression: false });
      }
    });
  });
});
