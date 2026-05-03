/**
 * D3.1 — Inbox route validateSearch: ?blocked=true → search.blocked === true
 *         sin param → search.blocked === undefined (no lanza)
 * D3.2 — Extendido desde el D3.1: valores inválidos quedan como undefined
 *
 * Refs: design §4.5 (risk: /inbox route debe aceptar blocked opcional),
 *       REQ-PALETTE-AI-002 escenario 1
 */
import { describe, it, expect } from "vitest";
import { validateInboxSearch } from "../_authenticated/inbox";

describe("Inbox route validateSearch (D3)", () => {
  it("D3.1a — ?blocked=true → search.blocked === true", () => {
    const result = validateInboxSearch({ blocked: "true" });
    expect(result.blocked).toBe(true);
  });

  it("D3.1b — ?blocked=false → search.blocked === false", () => {
    const result = validateInboxSearch({ blocked: "false" });
    expect(result.blocked).toBe(false);
  });

  it("D3.1c — sin param → search.blocked === undefined (no lanza)", () => {
    const result = validateInboxSearch({});
    expect(result.blocked).toBeUndefined();
  });

  it("D3.1d — backward compat: ?blocked no presente junto a otros params", () => {
    const result = validateInboxSearch({ from: "inbox" });
    expect(result.blocked).toBeUndefined();
  });
});
