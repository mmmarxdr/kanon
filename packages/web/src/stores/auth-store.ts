import { create } from "zustand";

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** Instance-level role flags from /me (KAN-49 PR1a). */
  isSuperAdmin: boolean;
  isInstanceAdmin: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  setLoading: (loading: boolean) => void;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Start true — bootstrap will resolve

  setUser: (user) => set({ user, isAuthenticated: true, isLoading: false }),

  clearUser: () => set({ user: null, isAuthenticated: false, isLoading: false }),

  setLoading: (loading) => set({ isLoading: loading }),

  /**
   * Bootstrap: call GET /api/auth/me to check for an existing session.
   * Called on app load. If the cookie is valid, populates user state.
   */
  bootstrap: async () => {
    try {
      const previousPrincipalId = get().user?.userId;
      set({ isLoading: true });
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (response.ok) {
        const user = (await response.json()) as AuthUser;
        if (previousPrincipalId && previousPrincipalId !== user.userId) {
          try {
            const { workCaptureLifecycle } = await import("@/lib/work-capture-lifecycle");
            await workCaptureLifecycle.deactivateCurrent("scope-switch");
          } catch {
            // The server lease remains the crash/offline convergence fallback.
          }
        }
        set({ user, isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  /**
   * Logout: call POST /api/auth/logout to clear cookies, then clear local state.
   */
  logout: async () => {
    try {
      const { workCaptureLifecycle } = await import("@/lib/work-capture-lifecycle");
      await workCaptureLifecycle.deactivateCurrent("logout");
    } catch {
      // Release is persisted before transport when possible; lease expiry is fallback.
    }
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort — clear local state regardless
    }
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
}));
