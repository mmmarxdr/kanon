import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCurrentProject } from "@/hooks/use-current-project";
import type { Project } from "@/types/project";

// Mock useLocation from TanStack Router
const mockPathname = vi.fn<() => string>(() => "/board/KAN");
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: mockPathname() }),
}));

// Mock useActiveWorkspaceId — not needed for these tests
vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: () => "ws-1",
}));

// Mock useProjectsQuery
const MOCK_PROJECTS: Project[] = [
  { id: "p-1", key: "KAN", name: "Kanon", description: null },
  { id: "p-2", key: "TEST", name: "Test Project", description: "A test project" },
];

const mockProjectsLoading = vi.fn<() => boolean>(() => false);
const mockProjectsData = vi.fn<() => Project[] | undefined>(() => MOCK_PROJECTS);

vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: () => ({
    data: mockProjectsData(),
    isLoading: mockProjectsLoading(),
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useCurrentProject", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockPathname.mockReturnValue("/board/KAN");
    mockProjectsLoading.mockReturnValue(false);
    mockProjectsData.mockReturnValue(MOCK_PROJECTS);
  });

  it("derives correct project from /board/:projectKey URL", () => {
    mockPathname.mockReturnValue("/board/KAN");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.projectKey).toBe("KAN");
    expect(result.current.project).toEqual(MOCK_PROJECTS[0]);
  });

  it("derives correct project from /backlog/:projectKey URL", () => {
    mockPathname.mockReturnValue("/backlog/TEST");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.projectKey).toBe("TEST");
    expect(result.current.project).toEqual(MOCK_PROJECTS[1]);
  });

  it("derives correct project from /roadmap/:projectKey URL", () => {
    mockPathname.mockReturnValue("/roadmap/KAN");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.projectKey).toBe("KAN");
    expect(result.current.project).toEqual(MOCK_PROJECTS[0]);
  });

  it("returns undefined project when no match in URL", () => {
    mockPathname.mockReturnValue("/settings");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.projectKey).toBe("");
    expect(result.current.project).toBeUndefined();
  });

  it("returns undefined project when projectKey does not match any project", () => {
    mockPathname.mockReturnValue("/board/UNKNOWN");
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.projectKey).toBe("UNKNOWN");
    expect(result.current.project).toBeUndefined();
  });

  it("handles loading state from useProjectsQuery", () => {
    mockProjectsLoading.mockReturnValue(true);
    mockProjectsData.mockReturnValue(undefined);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.project).toBeUndefined();
  });

  it("returns isLoading false when projects are loaded", () => {
    mockProjectsLoading.mockReturnValue(false);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCurrentProject(), { wrapper });

    expect(result.current.isLoading).toBe(false);
  });
});
