/**
 * CreateProjectModal — component tests (KAN-49 / PR2 task 2.3)
 *
 * Tests:
 *  (a) modal renders with name + key + submit fields
 *  (b) submit calls POST /api/workspaces/:id/projects with key + name
 *  (c) modal closes on successful submit (onClose called)
 *  (d) submit disabled when name/key invalid
 *  (e) key is auto-derived from name (when not manually touched)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateProjectModal } from "./create-project-modal";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockMutate, mockIsPending, mockIsError } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockIsPending: { value: false },
  mockIsError: { value: false },
}));

vi.mock("@/hooks/use-create-project-mutation", () => ({
  useCreateProjectMutation: () => ({
    mutate: mockMutate,
    get isPending() { return mockIsPending.value; },
    get isError() { return mockIsError.value; },
  }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function renderModal(workspaceId = "ws-1", onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <CreateProjectModal workspaceId={workspaceId} onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPending.value = false;
    mockIsError.value = false;
  });

  // ── (a) renders key fields ─────────────────────────────────────────────────

  it("(a) renders name, key, and submit button", () => {
    renderModal();
    expect(screen.getByTestId("create-project-modal")).toBeTruthy();
    expect(screen.getByTestId("new-project-name")).toBeTruthy();
    expect(screen.getByTestId("new-project-key")).toBeTruthy();
    expect(screen.getByTestId("new-project-submit")).toBeTruthy();
  });

  // ── (b) submit calls mutation with key + name ──────────────────────────────

  it("(b) filling name+key and submitting calls mutate with correct payload", async () => {
    renderModal();

    fireEvent.change(screen.getByTestId("new-project-name"), {
      target: { value: "My Project" },
    });
    // Manually set key so we control the exact value
    fireEvent.change(screen.getByTestId("new-project-key"), {
      target: { value: "MP" },
    });

    fireEvent.click(screen.getByTestId("new-project-submit"));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "My Project", key: "MP" }),
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  // ── (c) onClose called on success ─────────────────────────────────────────

  it("(c) onSuccess callback closes modal", async () => {
    const onClose = vi.fn();
    renderModal("ws-1", onClose);

    fireEvent.change(screen.getByTestId("new-project-name"), {
      target: { value: "Alpha" },
    });
    fireEvent.change(screen.getByTestId("new-project-key"), {
      target: { value: "ALP" },
    });
    fireEvent.click(screen.getByTestId("new-project-submit"));

    // Simulate the onSuccess callback being invoked
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    const [, options] = mockMutate.mock.calls[0] as [unknown, { onSuccess: () => void }];
    options.onSuccess();
    expect(onClose).toHaveBeenCalled();
  });

  // ── (d) submit disabled when invalid ──────────────────────────────────────

  it("(d) submit button is disabled when name is empty", () => {
    renderModal();
    // No name entered — key auto-derived will be empty too
    const submit = screen.getByTestId("new-project-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  // ── (e) key auto-derived from name ────────────────────────────────────────

  it("(e) key is auto-derived from name initials when not manually touched", async () => {
    renderModal();
    fireEvent.change(screen.getByTestId("new-project-name"), {
      target: { value: "Frontend Tooling" },
    });
    await waitFor(() => {
      const keyInput = screen.getByTestId("new-project-key") as HTMLInputElement;
      // "Frontend Tooling" → initials "FT"
      expect(keyInput.value).toBe("FT");
    });
  });
});
