import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueDeleteAction } from "./issue-delete-action";

function renderAction(options: { priority?: "critical" | "medium"; allowed?: boolean; linked?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const onDeleted = vi.fn();
  const rendered = render(
    <QueryClientProvider client={client}>
      <IssueDeleteAction
        issueKey="KAN-179"
        priority={options.priority ?? "medium"}
        capability={{ allowed: options.allowed ?? true, redmineLinked: options.linked ?? false }}
        projectKey="KAN"
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );
  return { ...rendered, onDeleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IssueDeleteAction", () => {
  it("does not expose deletion without the server-derived capability", () => {
    renderAction({ allowed: false });
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  it("shows a confirmation dialog with confirm enabled for a normal ticket", () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("dialog", { name: "Delete KAN-179?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
  });

  it("requires the exact case-sensitive identifier for a critical ticket", () => {
    renderAction({ priority: "critical" });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type KAN-179 to confirm"), { target: { value: "kan-179" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type KAN-179 to confirm"), { target: { value: "KAN-179" } });
    expect(confirm).toBeEnabled();
  });

  it("warns that linked Redmine deletion is queued rather than synchronous", () => {
    renderAction({ linked: true });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByText(/Redmine deletion will be queued/)).toBeInTheDocument();
  });

  it("navigates through the supplied callback only after deletion succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            auditLogId: "audit-1",
            deletedIssueId: "issue-1",
            deletedIssueKey: "KAN-179",
            remoteDeleteQueued: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { onDeleted } = renderAction();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });
});
