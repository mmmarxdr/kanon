import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IssueDescription } from "../issue-description";

describe("IssueDescription", () => {
  it("keeps autosizing as the sole owner of the textarea height", async () => {
    const user = userEvent.setup();
    render(<IssueDescription value="Editable description" onSave={vi.fn()} />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("textbox", { name: "Issue description" })).toHaveStyle({
      resize: "none",
      overflowY: "hidden",
    });
  });
});
