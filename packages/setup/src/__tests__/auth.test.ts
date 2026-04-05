import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import readline from "node:readline";

// Mock readline to prevent actual interactive prompts
vi.mock("node:readline", () => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  return {
    default: {
      createInterface: vi.fn(() => ({
        question: mockQuestion,
        close: mockClose,
      })),
    },
  };
});

const { resolveAuth } = await import("../auth.js");

describe("auth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["KANON_API_URL"];
    delete process.env["KANON_API_KEY"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function mockReadlineResponse(answer: string) {
    const mockRl = readline.createInterface({} as never);
    (mockRl.question as ReturnType<typeof vi.fn>).mockImplementation(
      (_q: string, cb: (answer: string) => void) => cb(answer)
    );
  }

  describe("flag precedence", () => {
    it("should use CLI flags over env vars", async () => {
      process.env["KANON_API_URL"] = "http://env-url";
      process.env["KANON_API_KEY"] = "env-key";

      const result = await resolveAuth({
        apiUrl: "http://flag-url",
        apiKey: "flag-key",
      });

      expect(result.apiUrl).toBe("http://flag-url");
      expect(result.apiKey).toBe("flag-key");
    });
  });

  describe("env var fallback", () => {
    it("should use env vars when no flags are provided", async () => {
      process.env["KANON_API_URL"] = "http://env-url";
      process.env["KANON_API_KEY"] = "env-key";

      const result = await resolveAuth({});

      expect(result.apiUrl).toBe("http://env-url");
      expect(result.apiKey).toBe("env-key");
    });
  });

  describe("apiUrl is required", () => {
    it("should throw error when apiUrl is missing and prompt returns empty", async () => {
      // Mock readline to return empty string (user presses Enter)
      mockReadlineResponse("");

      await expect(resolveAuth({})).rejects.toThrow("API URL is required");
    });
  });

  describe("interactive prompt fallback", () => {
    it("should use prompted value when no flags or env vars", async () => {
      mockReadlineResponse("http://prompted-url");

      const result = await resolveAuth({});

      expect(result.apiUrl).toBe("http://prompted-url");
    });
  });
});
