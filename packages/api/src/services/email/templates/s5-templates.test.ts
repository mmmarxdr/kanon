/**
 * Unit tests for S5 email templates — KAN-29
 *
 * 5.1 — mention template renders subject + html + text with context vars
 * 5.1 — assignment template renders subject + html + text
 * 5.1 — cycle-closed template includes cycle name, project, stats
 *
 * TDD: RED first — imports modules that do not yet exist.
 */

import { describe, it, expect } from "vitest";
import { buildMentionEmail } from "./mention.js";
import { buildAssignmentEmail } from "./assignment.js";
import { buildCycleClosedEmail } from "./cycle-closed.js";

// ─── mention template ────────────────────────────────────────────────────────

describe("buildMentionEmail", () => {
  const base = {
    mentionedByName: "Anya Petrova",
    issueKey: "KAN-42",
    issueTitle: "Fix the login flow",
    context: "@Anya can you review this?",
    issueUrl: "https://app.kanon.dev/issue/KAN-42",
    appUrl: "https://app.kanon.dev",
  };

  it("returns a non-empty subject containing the issue key", () => {
    const { subject } = buildMentionEmail(base);
    expect(subject).toBeTruthy();
    expect(subject).toContain("KAN-42");
  });

  it("returns html containing the mentioner name", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain("Anya Petrova");
  });

  it("returns html containing the issue key", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain("KAN-42");
  });

  it("returns html containing the issue title", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain("Fix the login flow");
  });

  it("returns html containing the context snippet", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain("@Anya can you review this?");
  });

  it("returns html with CTA href pointing to issue URL", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain('href="https://app.kanon.dev/issue/KAN-42"');
  });

  it("returns html with manage-notifications link pointing to app settings", () => {
    const { html } = buildMentionEmail(base);
    expect(html).toContain("https://app.kanon.dev");
  });

  it("returns non-empty text containing the issue key", () => {
    const { text } = buildMentionEmail(base);
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(20);
    expect(text).toContain("KAN-42");
  });

  it("escapes HTML special chars in mentionedByName", () => {
    const { html } = buildMentionEmail({ ...base, mentionedByName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML special chars in issueTitle", () => {
    const { html } = buildMentionEmail({ ...base, issueTitle: '<b>XSS</b>' });
    expect(html).not.toContain("<b>XSS</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  // KAN-203 Slice 2: instance email locale
  it("locale='es' translates the subject", () => {
    const { subject: enSubject } = buildMentionEmail(base);
    const { subject: esSubject } = buildMentionEmail({ ...base, locale: "es" });
    expect(esSubject).not.toBe(enSubject);
    expect(esSubject).toContain("mencionó");
  });
});

// ─── assignment template ─────────────────────────────────────────────────────

describe("buildAssignmentEmail", () => {
  const base = {
    assignedByName: "Bruno Lima",
    issueKey: "KAN-10",
    issueTitle: "Implement dark mode",
    issueUrl: "https://app.kanon.dev/issue/KAN-10",
    appUrl: "https://app.kanon.dev",
  };

  it("returns a non-empty subject containing the issue key", () => {
    const { subject } = buildAssignmentEmail(base);
    expect(subject).toBeTruthy();
    expect(subject).toContain("KAN-10");
  });

  it("returns html containing the assigner name", () => {
    const { html } = buildAssignmentEmail(base);
    expect(html).toContain("Bruno Lima");
  });

  it("returns html containing the issue key", () => {
    const { html } = buildAssignmentEmail(base);
    expect(html).toContain("KAN-10");
  });

  it("returns html containing the issue title", () => {
    const { html } = buildAssignmentEmail(base);
    expect(html).toContain("Implement dark mode");
  });

  it("returns html with CTA href pointing to issue URL", () => {
    const { html } = buildAssignmentEmail(base);
    expect(html).toContain('href="https://app.kanon.dev/issue/KAN-10"');
  });

  it("returns html with manage-notifications link pointing to app settings", () => {
    const { html } = buildAssignmentEmail(base);
    expect(html).toContain("https://app.kanon.dev");
  });

  it("returns non-empty text containing the issue key and assigner", () => {
    const { text } = buildAssignmentEmail(base);
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(20);
    expect(text).toContain("KAN-10");
    expect(text).toContain("Bruno Lima");
  });

  it("escapes HTML special chars in assignedByName", () => {
    const { html } = buildAssignmentEmail({ ...base, assignedByName: '<img src=x>' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML special chars in issueTitle", () => {
    const { html } = buildAssignmentEmail({ ...base, issueTitle: '<b>Bold</b>' });
    expect(html).not.toContain("<b>Bold</b>");
  });

  // KAN-203 Slice 2: instance email locale
  it("locale='es' translates the subject and heading", () => {
    const { subject: enSubject } = buildAssignmentEmail(base);
    const { subject: esSubject, html: esHtml } = buildAssignmentEmail({ ...base, locale: "es" });
    expect(esSubject).not.toBe(enSubject);
    expect(esSubject).toContain("asignado");
    expect(esHtml).toContain("te asignó");
  });
});

// ─── cycle-closed template ───────────────────────────────────────────────────

describe("buildCycleClosedEmail", () => {
  const base = {
    cycleName: "Sprint 14",
    projectName: "Kanon Core",
    projectKey: "KAN",
    velocity: 34,
    completed: 8,
    planned: 10,
    scopeAdded: 2,
    scopeRemoved: 1,
    appUrl: "https://app.kanon.dev",
  };

  it("returns a non-empty subject containing the cycle name", () => {
    const { subject } = buildCycleClosedEmail(base);
    expect(subject).toBeTruthy();
    expect(subject).toContain("Sprint 14");
  });

  it("returns html containing the cycle name", () => {
    const { html } = buildCycleClosedEmail(base);
    expect(html).toContain("Sprint 14");
  });

  it("returns html containing the project name", () => {
    const { html } = buildCycleClosedEmail(base);
    expect(html).toContain("Kanon Core");
  });

  it("returns html containing velocity (completed points)", () => {
    const { html } = buildCycleClosedEmail(base);
    expect(html).toContain("34");
  });

  it("returns html containing completed issue count", () => {
    const { html } = buildCycleClosedEmail(base);
    // "8" issues completed
    expect(html).toContain("8");
  });

  it("returns html containing planned issue count", () => {
    const { html } = buildCycleClosedEmail(base);
    expect(html).toContain("10");
  });

  it("returns html containing scope change counts", () => {
    const { html } = buildCycleClosedEmail(base);
    // scope added and removed
    expect(html).toContain("2");
    expect(html).toContain("1");
  });

  it("returns html with manage-notifications link pointing to app settings", () => {
    const { html } = buildCycleClosedEmail(base);
    expect(html).toContain("https://app.kanon.dev");
  });

  it("returns non-empty text containing cycle name and project", () => {
    const { text } = buildCycleClosedEmail(base);
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(20);
    expect(text).toContain("Sprint 14");
    expect(text).toContain("Kanon Core");
  });

  it("escapes HTML special chars in cycleName", () => {
    const { html } = buildCycleClosedEmail({ ...base, cycleName: '<script>xss</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML special chars in projectName", () => {
    const { html } = buildCycleClosedEmail({ ...base, projectName: '<b>Evil</b>' });
    expect(html).not.toContain("<b>Evil</b>");
  });

  // ── Fix 8: scope row omitted when both values are 0 ──────────────────────────

  it("omits scope-changes row when scopeAdded=0 and scopeRemoved=0 (fix-8)", () => {
    const { html, text } = buildCycleClosedEmail({ ...base, scopeAdded: 0, scopeRemoved: 0 });
    expect(html).not.toContain("Scope changes");
    expect(text).not.toContain("Scope changes");
  });

  it("includes scope-changes row when scopeAdded > 0 (fix-8)", () => {
    const { html } = buildCycleClosedEmail({ ...base, scopeAdded: 3, scopeRemoved: 0 });
    expect(html).toContain("Scope changes");
  });

  it("includes scope-changes row when scopeRemoved > 0 (fix-8)", () => {
    const { html } = buildCycleClosedEmail({ ...base, scopeAdded: 0, scopeRemoved: 2 });
    expect(html).toContain("Scope changes");
  });

  // KAN-203 Slice 2: instance email locale
  it("locale='es' translates the subject and stat labels", () => {
    const { subject: enSubject } = buildCycleClosedEmail(base);
    const { subject: esSubject, html: esHtml } = buildCycleClosedEmail({ ...base, locale: "es" });
    expect(esSubject).not.toBe(enSubject);
    expect(esSubject).toContain("Ciclo cerrado");
    expect(esHtml).toContain("Velocidad");
  });
});
