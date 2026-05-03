/**
 * D5.1 — AgentThread: input data-testid="agent-thread-input" tiene
 *         placeholder="View only · agents act via MCP" y disabled presente
 * D5.2 — Snapshot de AgentThread actualizado con nuevo copy
 * D5.3 — AgentThread con 0 mensajes: input sigue mostrando el nuevo copy
 *
 * Refs: REQ-AGENT-THREAD-001 escenarios 1-3, design §4.6
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentThread } from "../agent-thread";

describe("AgentThread (D5) — honest copy", () => {
  it("D5.1 — input tiene placeholder='View only · agents act via MCP' y disabled", () => {
    render(<AgentThread comments={[]} isLoading={false} />);

    const input = screen.getByTestId("agent-thread-input");
    expect(input.getAttribute("placeholder")).toBe("View only · agents act via MCP");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it("D5.2 — wrapper div tiene title correcto (honest copy sobre MCP)", () => {
    render(<AgentThread comments={[]} isLoading={false} />);

    const input = screen.getByTestId("agent-thread-input");
    // El div wrapper (padre del input que contiene el Spark icon + input + Kbd)
    const wrapper = input.closest("[title]");
    expect(wrapper?.getAttribute("title")).toBe(
      "View only — agents act via MCP. See KAN-50 for upcoming Ask Kanon roundtrip."
    );
  });

  it("D5.3 — con 0 mensajes MCP: placeholder no cambia según estado del thread", () => {
    render(<AgentThread comments={[]} isLoading={false} />);

    const input = screen.getByTestId("agent-thread-input");
    // Copy no cambia cuando no hay mensajes
    expect(input.getAttribute("placeholder")).toBe("View only · agents act via MCP");
  });
});
