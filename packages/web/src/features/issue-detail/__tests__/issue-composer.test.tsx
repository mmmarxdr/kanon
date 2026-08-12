import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IssueComposer } from "../issue-composer";

describe("IssueComposer", () => {
  it("grows to the draft height and hides its own vertical overflow", async () => {
    const user = userEvent.setup();
    render(<IssueComposer isPending={false} onSubmit={async () => undefined} />);
    const textarea = screen.getByRole("textbox");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 304 });

    await user.type(textarea, "A long draft that must remain in the document scroll flow.");

    expect(textarea).toHaveStyle({ height: "304px", overflowY: "hidden" });
  });

  it("returns to its intrinsic height after submitting the draft", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<IssueComposer isPending={false} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 34 });

    await user.type(textarea, "Send this");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith("Send this");
    expect(textarea).toHaveValue("");
    expect(textarea).toHaveStyle({ height: "34px", overflowY: "hidden" });
  });
});

describe("IssueComposer lifecycle feedback", () => {
  it("announces a pending submission and does not submit a second draft", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<IssueComposer isPending onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Draft");

    expect(screen.getByRole("status")).toHaveTextContent("Sending comment…");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps focus after reset and exposes a submission error", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<IssueComposer isPending={false} error={new Error("Comment rejected")} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Retry me");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith("Retry me");
    expect(textarea).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Comment rejected");
  });
});

describe("IssueComposer mutation contract", () => {
  it("keeps a newer draft when an earlier submission resolves", async () => {
    const user = userEvent.setup();
    let resolveSubmission!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmission = resolve; }));
    render(<IssueComposer isPending={false} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");

    await user.type(textarea, "Submitted draft");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.clear(textarea);
    await user.type(textarea, "Newer draft");
    await act(async () => { resolveSubmission(); await Promise.resolve(); });

    expect(onSubmit).toHaveBeenCalledWith("Submitted draft");
    expect(textarea).toHaveValue("Newer draft");
    expect(textarea).toHaveFocus();
  });

  it("retains a rejected pending draft, then clears and focuses exactly once after a retry resolves", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: () => void;
    const onSubmit = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSecond = resolve; }));
    const { rerender } = render(<IssueComposer isPending={false} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");

    await user.type(textarea, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Send" }));
    rerender(<IssueComposer isPending onSubmit={onSubmit} />);
    await act(async () => { rejectFirst(new Error("Comment rejected")); await Promise.resolve(); });
    rerender(<IssueComposer isPending={false} error={new Error("Comment rejected")} onSubmit={onSubmit} />);

    expect(textarea).toHaveValue("Keep this draft");
    expect(textarea).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Comment rejected");

    await user.click(screen.getByRole("button", { name: "Send" }));
    rerender(<IssueComposer isPending onSubmit={onSubmit} />);
    await act(async () => { resolveSecond(); await Promise.resolve(); });
    rerender(<IssueComposer isPending={false} onSubmit={onSubmit} />);

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(textarea).toHaveValue("");
    expect(textarea).toHaveFocus();
  });
});
