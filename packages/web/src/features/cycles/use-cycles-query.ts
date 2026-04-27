import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { cycleKeys } from "@/lib/query-keys";
import type { Cycle, CycleDetail } from "@/types/cycle";

export function useCyclesQuery(projectKey: string | undefined) {
  return useQuery({
    queryKey: cycleKeys.list(projectKey ?? ""),
    queryFn: () =>
      fetchApi<Cycle[]>(`/api/projects/${encodeURIComponent(projectKey!)}/cycles`),
    enabled: !!projectKey,
    staleTime: 30_000,
  });
}

export function useCycleQuery(cycleId: string | undefined) {
  return useQuery({
    queryKey: cycleKeys.detail(cycleId ?? ""),
    queryFn: () =>
      fetchApi<CycleDetail>(`/api/cycles/${encodeURIComponent(cycleId!)}`),
    enabled: !!cycleId,
    staleTime: 15_000,
  });
}
