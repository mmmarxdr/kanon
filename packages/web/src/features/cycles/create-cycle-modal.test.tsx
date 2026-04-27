import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the mutations module so we can intercept calls
vi.mock("./use-cycle-mutations", () => ({
  useCreateCycleMutation: vi.fn(),
}));

// FocusTrap calls into real DOM and can cause issues in jsdom — allow outside click
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const PROJECT_KEY = "TEST";

async function renderModal(onClose = vi.fn()) {
  const { useCreateCycleMutation } = await import("./use-cycle-mutations");
  const mutateMock = vi.fn();
  vi.mocked(useCreateCycleMutation).mockReturnValue({
    mutate: mutateMock,
    isPending: false,
    isError: false,
    isSuccess: false,
  } as unknown as ReturnType<typeof useCreateCycleMutation>);

  const { CreateCycleModal } = await import("./create-cycle-modal");
  const wrapper = createWrapper();
  render(
    <CreateCycleModal projectKey={PROJECT_KEY} onClose={onClose} />,
    { wrapper },
  );
  return { mutateMock, onClose };
}

describe("CreateCycleModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submit button is disabled when name is empty or whitespace-only", async () => {
    await renderModal();

    const submit = screen.getByTestId("new-cycle-submit");
    expect(submit).toBeDisabled();

    // Whitespace-only name
    const nameInput = screen.getByTestId("new-cycle-name");
    await userEvent.type(nameInput, "   ");
    expect(submit).toBeDisabled();
  });

  it("submit button is disabled when endDate is not after startDate", async () => {
    await renderModal();

    const nameInput = screen.getByTestId("new-cycle-name");
    const startInput = screen.getByTestId("new-cycle-start-date");
    const endInput = screen.getByTestId("new-cycle-end-date");
    const submit = screen.getByTestId("new-cycle-submit");

    await userEvent.type(nameInput, "Sprint 1");
    fireEvent.change(startInput, { target: { value: "2026-05-14" } });
    fireEvent.change(endInput, { target: { value: "2026-05-01" } }); // end before start
    expect(submit).toBeDisabled();

    // Equal dates also invalid
    fireEvent.change(endInput, { target: { value: "2026-05-14" } }); // same as start
    expect(submit).toBeDisabled();
  });

  it("submitting a valid form calls mutate with correct payload and closes on mock-success", async () => {
    const { useCreateCycleMutation } = await import("./use-cycle-mutations");
    const onClose = vi.fn();
    const mutateMock = vi.fn((_input, opts) => {
      // Simulate success callback
      opts?.onSuccess?.();
    });

    vi.mocked(useCreateCycleMutation).mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      isSuccess: false,
    } as unknown as ReturnType<typeof useCreateCycleMutation>);

    const { CreateCycleModal } = await import("./create-cycle-modal");
    const wrapper = createWrapper();
    render(
      <CreateCycleModal projectKey={PROJECT_KEY} onClose={onClose} />,
      { wrapper },
    );

    await userEvent.type(screen.getByTestId("new-cycle-name"), "Sprint 1");
    fireEvent.change(screen.getByTestId("new-cycle-start-date"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(screen.getByTestId("new-cycle-end-date"), {
      target: { value: "2026-05-14" },
    });

    fireEvent.click(screen.getByTestId("new-cycle-submit"));

    expect(mutateMock).toHaveBeenCalledOnce();
    const callArg = mutateMock.mock.calls[0]![0];
    expect(callArg.name).toBe("Sprint 1");
    // Dates should be present and non-empty
    expect(callArg.startDate).toBeTruthy();
    expect(callArg.endDate).toBeTruthy();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("pressing Escape fires onClose", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop fires onClose", async () => {
    const onClose = vi.fn();
    await renderModal(onClose);

    const backdrop = screen.getByTestId("new-cycle-modal").parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
