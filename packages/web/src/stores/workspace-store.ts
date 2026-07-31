import { create } from "zustand";

export const ACTIVE_WORKSPACE_STORAGE_KEY = "kanon-active-workspace-id";

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
}

function loadActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistActiveWorkspaceId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
    }
  } catch {
    // localStorage unavailable
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: loadActiveWorkspaceId(),

  setActiveWorkspaceId: (id) =>
    set(() => {
      persistActiveWorkspaceId(id);
      return { activeWorkspaceId: id };
    }),
}));

/**
 * Pure resolver: prefer stored id if still a member, else first workspace.
 * When falling back, returns `{ id, shouldPersist }` so callers can rewrite storage.
 */
export function resolveActiveWorkspaceId(
  storedId: string | null | undefined,
  workspaceIds: string[],
): { id: string | undefined; shouldPersist: boolean } {
  if (workspaceIds.length === 0) {
    return { id: undefined, shouldPersist: storedId != null };
  }
  if (storedId && workspaceIds.includes(storedId)) {
    return { id: storedId, shouldPersist: false };
  }
  return { id: workspaceIds[0], shouldPersist: storedId !== workspaceIds[0] };
}
