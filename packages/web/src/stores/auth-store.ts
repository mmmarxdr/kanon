import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
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
      set({ isLoading: true });
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (response.ok) {
        const user = (await response.json()) as AuthUser;
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
