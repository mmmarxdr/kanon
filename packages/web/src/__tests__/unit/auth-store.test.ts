import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthUser } from "@/stores/auth-store";

// Mock fetch for bootstrap/logout tests
const fetchMock = vi.spyOn(globalThis, "fetch");

describe("useAuthStore", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Reset store to defaults
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  describe("initial state", () => {
    it("starts with null user", () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe("setUser", () => {
    it("stores the user object and sets isAuthenticated", () => {
      const user: AuthUser = {
        memberId: "m-1",
        email: "alice@example.com",
        username: "alice",
        workspaceId: "ws-1",
        role: "member",
      };

      useAuthStore.getState().setUser(user);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });
  });

  describe("clearUser", () => {
    it("clears user and sets isAuthenticated to false", () => {
      useAuthStore.getState().setUser({
        memberId: "m-1",
        email: "test@test.com",
        username: "tester",
        workspaceId: "ws-1",
        role: "admin",
      });

      useAuthStore.getState().clearUser();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it("is idempotent (calling clearUser when already cleared)", () => {
      useAuthStore.getState().clearUser();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe("logout", () => {
    it("calls POST /api/auth/logout and clears state", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      useAuthStore.getState().setUser({
        memberId: "m-1",
        email: "test@test.com",
        username: "tester",
        workspaceId: "ws-1",
        role: "admin",
      });

      await useAuthStore.getState().logout();

      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it("clears state even if logout request fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      useAuthStore.getState().setUser({
        memberId: "m-1",
        email: "test@test.com",
        username: "tester",
        workspaceId: "ws-1",
        role: "admin",
      });

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe("bootstrap", () => {
    it("populates user on successful /me response", async () => {
      const user: AuthUser = {
        memberId: "m-1",
        email: "test@test.com",
        username: "tester",
        workspaceId: "ws-1",
        role: "admin",
      };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it("clears state on 401 /me response", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("clears state on network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });
});
