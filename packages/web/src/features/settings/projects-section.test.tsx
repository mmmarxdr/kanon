import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { fetchApi } from "@/lib/api-client";
import { ProjectsSection } from "./projects-section";

vi.mock("@/hooks/use-projects-query", () => ({ useProjectsQuery: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ fetchApi: vi.fn() }));
vi.mock("@/features/projects/create-project-modal", () => ({
  CreateProjectModal: () => <div data-testid="create-project-modal" />,
}));

const project = {
  id: "33333333-3333-4333-8333-333333333333",
  key: "KAN",
  name: "Kanon",
  description: "Project management",
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectsSection workspaceId="22222222-2222-4222-8222-222222222222" />
    </QueryClientProvider>,
  );
}

describe("ProjectsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: [project],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectsQuery>);
    vi.mocked(fetchApi).mockResolvedValue(project);
  });

  it("edits name and description without exposing an editable project key", async () => {
    renderSection();

    expect(screen.getByText("KAN")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("KAN")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kanon PM" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(fetchApi).toHaveBeenCalledWith(
        "/api/workspaces/22222222-2222-4222-8222-222222222222/projects/33333333-3333-4333-8333-333333333333",
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Kanon PM", description: "Updated" }),
        },
      ),
    );
  });

  it("requires explicit confirmation before archiving", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderSection();
    const archive = screen.getByRole("button", { name: "Archive project" });

    fireEvent.click(archive);
    expect(fetchApi).not.toHaveBeenCalled();
    fireEvent.click(archive);

    await waitFor(() =>
      expect(fetchApi).toHaveBeenCalledWith(
        "/api/workspaces/22222222-2222-4222-8222-222222222222/projects/33333333-3333-4333-8333-333333333333",
        { method: "DELETE" },
      ),
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("reuses CreateProjectModal", () => {
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByTestId("create-project-modal")).toBeInTheDocument();
  });
});
