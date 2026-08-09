import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchApi, fetchApiValidated } from "@/lib/api-client";
import { integrationKeys } from "@/lib/query-keys";
import {
  useBindRedmineProjectMutation,
  useClearRedmineCredentialMutation,
  useConfigureRedmineProviderMapsMutation,
  useConnectRedmineCredentialMutation,
  useCreateRedmineConnectionMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
  useReplaceRedmineServiceCredentialMutation,
  useSetRedmineLifecycleMutation,
  useUnbindRedmineProjectMutation,
} from "./use-redmine-integration";

vi.mock("@/lib/api-client", () => ({ fetchApi: vi.fn(), fetchApiValidated: vi.fn() }));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "99999999-9999-4999-8999-999999999999";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("Redmine integration hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("scopes connection and discovery queries by workspace", async () => {
    vi.mocked(fetchApiValidated).mockResolvedValue(null);
    const { queryClient, wrapper } = createWrapper();
    const connection = renderHook(() => useRedmineConnectionQuery(WORKSPACE_ID), { wrapper });

    await waitFor(() => expect(connection.result.current.isSuccess).toBe(true));
    expect(fetchApiValidated).toHaveBeenCalledWith(
      `/api/integrations/workspaces/${WORKSPACE_ID}/connections`,
      expect.anything(),
    );
    expect(queryClient.getQueryState(integrationKeys.connection(WORKSPACE_ID))).toBeDefined();

    const discovery = renderHook(
      () => useRedmineDiscoveryQuery(WORKSPACE_ID, CONNECTION_ID, true),
      { wrapper },
    );
    await waitFor(() => expect(discovery.result.current.isSuccess).toBe(true));
    expect(fetchApiValidated).toHaveBeenLastCalledWith(
      `/api/integrations/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/discovery`,
      expect.anything(),
    );
    expect(
      queryClient.getQueryState(integrationKeys.discovery(WORKSPACE_ID, CONNECTION_ID)),
    ).toBeDefined();
  });

  it("polls only while a binding release is pending", async () => {
    vi.mocked(fetchApiValidated).mockResolvedValue({ bindings: [{ releasePending: true }] });
    const { queryClient, wrapper } = createWrapper();
    const connection = renderHook(() => useRedmineConnectionQuery(WORKSPACE_ID), { wrapper });
    await waitFor(() => expect(connection.result.current.isSuccess).toBe(true));
    const query = queryClient.getQueryCache().find({
      queryKey: integrationKeys.connection(WORKSPACE_ID),
    });
    const refetchInterval = (query?.options as { refetchInterval?: unknown }).refetchInterval;
    if (typeof refetchInterval !== "function" || !query) throw new Error("Missing polling policy");

    expect(refetchInterval(query)).toBe(2_000);
    queryClient.setQueryData(integrationKeys.connection(WORKSPACE_ID), { bindings: [] });
    expect(refetchInterval(query)).toBe(false);
  });

  it("uses workspace-scoped owner mutation paths", async () => {
    vi.mocked(fetchApi).mockResolvedValue({});
    const { wrapper } = createWrapper();
    const create = renderHook(() => useCreateRedmineConnectionMutation(WORKSPACE_ID), { wrapper });
    const replace = renderHook(
      () => useReplaceRedmineServiceCredentialMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const maps = renderHook(
      () => useConfigureRedmineProviderMapsMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const lifecycle = renderHook(
      () => useSetRedmineLifecycleMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const mapInput = {
      timeActivityId: "9",
      readMap: {},
      writeMap: {
        backlog: "1",
        analysis: "1",
        todo: "1",
        in_progress: "2",
        review: "2",
        done: "3",
      },
      priorityReadMap: {},
      priorityWriteMap: { critical: "4", high: "3", medium: "2", low: "1" },
    };

    await act(async () => {
      await create.result.current.mutateAsync("service-key");
      await replace.result.current.mutateAsync("replacement-key");
      await maps.result.current.mutateAsync(mapInput);
      await lifecycle.result.current.mutateAsync("paused");
    });

    const root = `/api/integrations/workspaces/${WORKSPACE_ID}/connections`;
    expect(fetchApi).toHaveBeenCalledWith(root, {
      method: "POST",
      body: JSON.stringify({ apiKey: "service-key" }),
    });
    expect(fetchApi).toHaveBeenCalledWith(`${root}/${CONNECTION_ID}/service-credential`, {
      method: "PUT",
      body: JSON.stringify({ apiKey: "replacement-key" }),
    });
    expect(fetchApi).toHaveBeenCalledWith(`${root}/${CONNECTION_ID}/provider-maps`, {
      method: "PUT",
      body: JSON.stringify(mapInput),
    });
    expect(fetchApi).toHaveBeenCalledWith(`${root}/${CONNECTION_ID}/lifecycle`, {
      method: "PATCH",
      body: JSON.stringify({ lifecycle: "paused" }),
    });
  });

  it("uses workspace-scoped bind and unbind paths", async () => {
    vi.mocked(fetchApi).mockResolvedValue({});
    const { wrapper } = createWrapper();
    const bind = renderHook(
      () => useBindRedmineProjectMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const unbind = renderHook(
      () => useUnbindRedmineProjectMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const input = { projectId: "33333333-3333-4333-8333-333333333333", remoteProjectId: "7" };

    await act(async () => {
      await bind.result.current.mutateAsync(input);
      await unbind.result.current.mutateAsync(BINDING_ID);
    });

    const root = `/api/integrations/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/bindings`;
    expect(fetchApi).toHaveBeenCalledWith(root, {
      method: "PUT",
      body: JSON.stringify(input),
    });
    expect(fetchApi).toHaveBeenCalledWith(`${root}/${BINDING_ID}`, { method: "DELETE" });
  });

  it("uses the connection-scoped personal credential path", async () => {
    vi.mocked(fetchApi).mockResolvedValue({});
    const { wrapper } = createWrapper();
    const connect = renderHook(
      () => useConnectRedmineCredentialMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );
    const clear = renderHook(
      () => useClearRedmineCredentialMutation(WORKSPACE_ID, CONNECTION_ID),
      { wrapper },
    );

    await act(async () => {
      await connect.result.current.mutateAsync("personal-key");
      await clear.result.current.mutateAsync();
    });

    const path = `/api/integrations/workspaces/${WORKSPACE_ID}/connections/${CONNECTION_ID}/credential`;
    expect(fetchApi).toHaveBeenCalledWith(path, {
      method: "POST",
      body: JSON.stringify({ apiKey: "personal-key" }),
    });
    expect(fetchApi).toHaveBeenCalledWith(path, { method: "DELETE" });
  });
});
