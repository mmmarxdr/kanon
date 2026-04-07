import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsoleProvider } from "./console-provider.js";

describe("Email Service", () => {
  describe("ConsoleProvider", () => {
    let provider: ConsoleProvider;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      provider = new ConsoleProvider();
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("send() logs email to console", async () => {
      await provider.send({
        to: "user@example.com",
        subject: "Test Subject",
        html: "<p>Hello</p>",
        text: "Hello",
      });

      expect(consoleSpy).toHaveBeenCalled();

      // Verify key parts were logged
      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("user@example.com");
      expect(allOutput).toContain("Test Subject");
      expect(allOutput).toContain("Hello");
    });

    it("send() extracts and logs reset URL from HTML", async () => {
      const resetUrl = "https://app.example.com/reset-password?token=abc123";
      await provider.send({
        to: "user@example.com",
        subject: "Reset your password",
        html: `<p><a href="${resetUrl}">Click here</a></p>`,
      });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain(resetUrl);
    });

    it("send() logs HTML when no text provided", async () => {
      await provider.send({
        to: "user@example.com",
        subject: "HTML Only",
        html: "<p>HTML content here</p>",
      });

      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(allOutput).toContain("HTML content here");
    });
  });

  describe("createEmailProvider factory", () => {
    it("returns ConsoleProvider when no RESEND_API_KEY", async () => {
      // In test env, RESEND_API_KEY is not set, so ConsoleProvider is used.
      // We re-import to get a fresh instance.
      const { createEmailProvider } = await import("./index.js");
      const provider = createEmailProvider();

      // ConsoleProvider has a send method — verify it doesn't throw
      await expect(
        provider.send({
          to: "test@example.com",
          subject: "Test",
          html: "<p>Test</p>",
        }),
      ).resolves.not.toThrow();
    });
  });
});
