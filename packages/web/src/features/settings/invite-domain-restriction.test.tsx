/**
 * Tests for InviteDomainRestriction.
 *
 * Covers:
 * - Owner sees the disclosure and can add/remove allowed domains.
 * - Non-owner (including admin) sees nothing — no disclosure, no controls.
 *
 * Pattern: mock hooks, render component, assert DOM state and mutation calls.
 * Mirrors members-section.test.tsx / notification-preferences-section.test.tsx harness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("./use-settings-queries", () => ({
  useUpdateWorkspaceMutation: vi.fn(),
}));

const WORKSPACE_ID = "ws-test-123";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderDisclosure(opts: {
  currentUserRole?: string;
  allowedDomains?: string[];
  mutateFn?: ReturnType<typeof vi.fn>;
  isPending?: boolean;
  isError?: boolean;
  error?: Error;
}) {
  const { useUpdateWorkspaceMutation } = await import("./use-settings-queries");

  const mutateFn = opts.mutateFn ?? vi.fn();

  vi.mocked(useUpdateWorkspaceMutation).mockReturnValue({
    mutate: mutateFn,
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
    error: opts.error,
  } as unknown as ReturnType<typeof useUpdateWorkspaceMutation>);

  const { InviteDomainRestriction } = await import("./invite-domain-restriction");

  const wrapper = createWrapper();
  const result = render(
    <InviteDomainRestriction
      workspaceId={WORKSPACE_ID}
      currentUserRole={opts.currentUserRole}
      allowedDomains={opts.allowedDomains ?? []}
    />,
    { wrapper },
  );

  return { mutateFn, ...result };
}

describe("InviteDomainRestriction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for a non-owner admin", async () => {
    const { container } = await renderDisclosure({ currentUserRole: "admin" });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a member", async () => {
    const { container } = await renderDisclosure({ currentUserRole: "member" });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the disclosure for an owner", async () => {
    await renderDisclosure({ currentUserRole: "owner" });
    expect(
      screen.getByText("Restrict who can join via invite link"),
    ).toBeInTheDocument();
  });

  it("owner adds a domain, which calls the mutation with the appended list", async () => {
    const { mutateFn } = await renderDisclosure({
      currentUserRole: "owner",
      allowedDomains: ["existing.com"],
    });

    const input = screen.getByPlaceholderText("example.com");
    fireEvent.change(input, { target: { value: "acme.com" } });
    fireEvent.click(screen.getByText("Add Domain"));

    expect(mutateFn).toHaveBeenCalledWith(
      { allowedDomains: ["existing.com", "acme.com"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("owner removes a domain, which calls the mutation with the filtered list", async () => {
    const { mutateFn } = await renderDisclosure({
      currentUserRole: "owner",
      allowedDomains: ["existing.com", "other.com"],
    });

    fireEvent.click(screen.getByLabelText("Remove existing.com"));

    expect(mutateFn).toHaveBeenCalledWith({ allowedDomains: ["other.com"] });
  });
});
