/**
 * D1.1 — ProjectPickerPopover con 0 proyectos: disabled=true, open() no monta popover
 * D1.2 — ProjectPickerPopover con 1 proyecto: open() invoca onSelect directamente sin popover
 * D1.3 — ProjectPickerPopover con 2 proyectos: open() muestra popover; click en opción → onSelect + cierra
 *
 * Refs: REQ-INBOX-QUICK-003 escenarios 1-3, REQ-INBOX-QUICK-004 escenarios 1-2, design §4.4
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectPickerPopover } from "../project-picker-popover";

const P1 = { key: "ATLAS", name: "Atlas" };
const P2 = { key: "PHOENIX", name: "Phoenix" };

describe("ProjectPickerPopover", () => {
  it("D1.1 — 0 proyectos: children recibe disabled=true; open() no muestra popover", () => {
    const onSelect = vi.fn();
    render(
      <ProjectPickerPopover projects={[]} onSelect={onSelect}>
        {(open, disabled) => (
          <button
            type="button"
            onClick={open}
            aria-disabled={disabled}
            data-testid="trigger"
          >
            Open
          </button>
        )}
      </ProjectPickerPopover>
    );

    const trigger = screen.getByTestId("trigger");
    expect(trigger.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(trigger);

    // No popover en DOM
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("D1.2 — 1 proyecto: open() invoca onSelect('ATLAS') directamente sin montar popover", () => {
    const onSelect = vi.fn();
    render(
      <ProjectPickerPopover projects={[P1]} onSelect={onSelect}>
        {(open, disabled) => (
          <button
            type="button"
            onClick={open}
            aria-disabled={disabled}
            data-testid="trigger"
          >
            Open
          </button>
        )}
      </ProjectPickerPopover>
    );

    const trigger = screen.getByTestId("trigger");
    // disabled debe ser false cuando hay 1 proyecto
    expect(trigger.getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(trigger);

    // onSelect llamado con la key del único proyecto
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("ATLAS");
    // Popover NO montado
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("D1.3 — 2 proyectos: open() muestra popover; click en 'PHOENIX' → onSelect + cierra", () => {
    const onSelect = vi.fn();
    render(
      <ProjectPickerPopover projects={[P1, P2]} onSelect={onSelect}>
        {(open, disabled) => (
          <button
            type="button"
            onClick={open}
            aria-disabled={disabled}
            data-testid="trigger"
          >
            Open
          </button>
        )}
      </ProjectPickerPopover>
    );

    const trigger = screen.getByTestId("trigger");
    fireEvent.click(trigger);

    // Popover visible
    expect(screen.getByRole("menu")).toBeTruthy();
    // Ambas opciones visibles
    expect(screen.getByText("Atlas")).toBeTruthy();
    expect(screen.getByText("Phoenix")).toBeTruthy();

    // Click en Phoenix
    fireEvent.click(screen.getByText("Phoenix"));

    expect(onSelect).toHaveBeenCalledWith("PHOENIX");
    // Popover cerrado
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
