import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("ReconcileModal", () => {
  it("renders the captured hours reported by the server", async () => {
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={5}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("reconcile-modal")).toBeInTheDocument();
    expect(screen.getByTestId("reconcile-hours-input")).toHaveValue("5");
    expect(screen.getByTestId("reconcile-reported-hours")).toHaveTextContent("5");
  });

  it("does not call onConfirm until the user explicitly confirms", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={5}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with the reported total when the user does not adjust the value", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm & move to done/i }));

    expect(onConfirm).toHaveBeenCalledWith(3);
  });

  it("confirms with the adjusted total when the user changes the value", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId("reconcile-hours-input");
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm & move to done/i }));

    expect(onConfirm).toHaveBeenCalledWith(2.5);
  });

  it("disables confirm when the adjusted value is negative", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId("reconcile-hours-input");
    fireEvent.change(input, { target: { value: "-1" } });

    const confirmButton = screen.getByRole("button", {
      name: /confirm & move to done/i,
    });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables confirm when the adjusted value exceeds 744", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId("reconcile-hours-input");
    fireEvent.change(input, { target: { value: "745" } });

    expect(
      screen.getByRole("button", { name: /confirm & move to done/i }),
    ).toBeDisabled();
  });

  it("disables confirm when the adjusted value has more than 2 decimals", async () => {
    const onConfirm = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId("reconcile-hours-input");
    fireEvent.change(input, { target: { value: "2.999" } });

    expect(
      screen.getByRole("button", { name: /confirm & move to done/i }),
    ).toBeDisabled();
  });

  it("calls onClose on cancel without calling onConfirm", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { ReconcileModal } = await import("./reconcile-modal");
    render(
      <ReconcileModal
        issueKey="ENG-1"
        totalHours={3}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
