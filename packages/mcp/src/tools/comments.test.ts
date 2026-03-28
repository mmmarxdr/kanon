import { describe, it, expect } from "vitest";
import { formatCommentBody } from "./comments.js";

// ─── formatCommentBody ────────────────────────────────────────────────────────

const MAX_BODY_CHARS = 9900;
const FOOTER_RESERVE = 200;
const MAX_CONTENT = MAX_BODY_CHARS - FOOTER_RESERVE; // 9700

describe("formatCommentBody", () => {
  it("full input — produces correct markdown with all metadata footer items", () => {
    const result = formatCommentBody({
      title: "Architecture Decision",
      content: "Chose Zod for validation.",
      observationType: "decision",
      observationId: 42,
      topicKey: "architecture/auth-model",
    });

    expect(result).toBe(
      [
        "## 🧠 Architecture Decision",
        "",
        "Chose Zod for validation.",
        "",
        "---",
        "*Synced from Engram • decision • #42 • `architecture/auth-model`*",
      ].join("\n"),
    );
  });

  it("minimal input (title + content only) — footer has no optional items", () => {
    const result = formatCommentBody({
      title: "Simple Note",
      content: "Just a note.",
    });

    expect(result).toBe(
      [
        "## 🧠 Simple Note",
        "",
        "Just a note.",
        "",
        "---",
        "*Synced from Engram*",
      ].join("\n"),
    );
  });

  it("content over 9700 chars — truncated with marker", () => {
    const longContent = "x".repeat(MAX_CONTENT + 1);
    const result = formatCommentBody({ title: "T", content: longContent });

    const expectedContent = "x".repeat(MAX_CONTENT) + "\n\n*[content truncated]*";
    expect(result).toContain(expectedContent);
    expect(result).not.toContain("x".repeat(MAX_CONTENT + 1));
  });

  it("content exactly at 9700 chars — NOT truncated", () => {
    const exactContent = "y".repeat(MAX_CONTENT);
    const result = formatCommentBody({ title: "T", content: exactContent });

    expect(result).toContain(exactContent);
    expect(result).not.toContain("[content truncated]");
  });

  it("short content — passes through unchanged", () => {
    const shortContent = "Short message.";
    const result = formatCommentBody({ title: "T", content: shortContent });

    expect(result).toContain(shortContent);
    expect(result).not.toContain("[content truncated]");
  });

  it("observationId=0 — included in footer (falsy but defined)", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationId: 0,
    });

    expect(result).toContain("#0");
  });

  it("empty string optional fields — omitted from footer", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationType: "",
      topicKey: "",
    });

    // Empty strings are falsy — they should not appear in the footer
    expect(result).toBe(
      [
        "## 🧠 T",
        "",
        "C",
        "",
        "---",
        "*Synced from Engram*",
      ].join("\n"),
    );
  });

  it("only observationType provided — footer has type but no id or topicKey", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      observationType: "bugfix",
    });

    const footerLine = result.split("\n").at(-1)!;
    expect(footerLine).toContain("bugfix");
    expect(footerLine).not.toContain("#");
    expect(footerLine).not.toContain("`");
  });

  it("only topicKey provided — footer has topicKey but no type or id", () => {
    const result = formatCommentBody({
      title: "T",
      content: "C",
      topicKey: "sdd/my-change/design",
    });

    const footerLine = result.split("\n").at(-1)!;
    expect(footerLine).toContain("`sdd/my-change/design`");
    expect(footerLine).not.toContain("#");
  });

  it("output always starts with the heading line", () => {
    const result = formatCommentBody({ title: "My Title", content: "Body text." });
    expect(result.startsWith("## 🧠 My Title\n")).toBe(true);
  });

  it("output always ends with the footer italic line", () => {
    const result = formatCommentBody({ title: "T", content: "C" });
    expect(result.endsWith("*Synced from Engram*")).toBe(true);
  });
});
