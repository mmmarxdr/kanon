import { describe, it, expect } from "vitest";
import { renderEmailLayout } from "../layout.js";
import { buildVerifyEmail } from "./verify.js";
import { buildResetEmail } from "./reset.js";
import { buildInviteEmail } from "./invite.js";

// ─── Layout renderer ──────────────────────────────────────────────────────────

describe("renderEmailLayout", () => {
  it("produces a 600px wide card structure", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "Hello world",
      bodyHtml: "<p>Body</p>",
      cta: { label: "Click →", href: "https://example.com/action" },
    });

    expect(html).toContain("600");
    expect(html).toContain("#F4F4F2"); // page bg
    expect(html).toContain("#FFFFFF"); // card bg
  });

  it("renders heading in serif italic style", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "My Heading",
      bodyHtml: "<p>Body</p>",
      cta: { label: "Go →", href: "https://example.com" },
    });

    expect(html).toContain("My Heading");
    expect(html).toContain("italic");
    expect(html).toContain("Georgia");
  });

  it("renders eyebrow text in mono uppercase style", () => {
    const html = renderEmailLayout({
      eyebrow: "Step 1 of 2 — verify",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });

    expect(html).toContain("Step 1 of 2 — verify");
    expect(html).toContain("uppercase");
    expect(html).toContain("Courier New");
  });

  it("renders warn eyebrow tone with warn color", () => {
    const html = renderEmailLayout({
      eyebrow: "Password reset",
      eyebrowTone: "warn",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });

    expect(html).toContain("#B5621D"); // warn color
  });

  it("renders CTA button with correct href", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Verify email →", href: "https://app.kanon.dev/verify-email?token=abc123" },
    });

    expect(html).toContain('href="https://app.kanon.dev/verify-email?token=abc123"');
    expect(html).toContain("Verify email →");
  });

  it("renders text logo ◆ Kanon in header", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });

    expect(html).toContain("◆");
    expect(html).toContain("Kanon");
  });

  it("renders footer meta with address and unsubscribe", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });

    expect(html).toContain("Cromwell");
    expect(html).toContain("Unsubscribe");
  });

  it("includes optional link fallback block when linkFallback provided", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://app.kanon.dev/verify-email?token=xyz" },
      linkFallback: "https://app.kanon.dev/verify-email?token=xyz",
    });

    expect(html).toContain("https://app.kanon.dev/verify-email?token=xyz");
    expect(html).toContain("paste");
  });

  it("omits link fallback block when not provided", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });

    expect(html).not.toContain("paste");
  });

  // ── Fix 4: heading and eyebrow are escaped inside renderEmailLayout ───────────

  it("escapes <script> in heading (fix-4)", () => {
    const html = renderEmailLayout({
      eyebrow: "Test",
      eyebrowTone: "default",
      heading: '<script>alert(1)</script>',
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes <script> in eyebrow (fix-4)", () => {
    const html = renderEmailLayout({
      eyebrow: '<script>xss</script>',
      eyebrowTone: "default",
      heading: "H",
      bodyHtml: "<p>B</p>",
      cta: { label: "Go", href: "https://example.com" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── Verify template ──────────────────────────────────────────────────────────

describe("buildVerifyEmail", () => {
  const verifyUrl = "https://app.kanon.dev/verify-email?token=tok_abc123";

  it("returns correct subject containing Verify", () => {
    const { subject } = buildVerifyEmail({ verifyUrl });
    expect(subject).toContain("Verify");
  });

  it("returns HTML containing the token query param", () => {
    const { html } = buildVerifyEmail({ verifyUrl });
    // existing integration test regex: /token=([^"&\s]+)/
    const match = html.match(/token=([^"&\s]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("tok_abc123");
  });

  it("returns HTML containing /verify-email?token= path", () => {
    const { html } = buildVerifyEmail({ verifyUrl });
    expect(html).toContain("/verify-email?token=");
  });

  it("returns a non-empty plaintext alternative", () => {
    const { text } = buildVerifyEmail({ verifyUrl });
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(20);
    expect(text).toContain(verifyUrl);
  });

  it("renders eyebrow with verify step label", () => {
    const { html } = buildVerifyEmail({ verifyUrl });
    expect(html).toContain("verify");
  });

  // Triangulation: different token shape
  it("handles tokens with hyphens and underscores correctly", () => {
    const url = "https://app.kanon.dev/verify-email?token=abc-def_ghi";
    const { html } = buildVerifyEmail({ verifyUrl: url });
    expect(html).toContain("/verify-email?token=abc-def_ghi");
    const match = html.match(/token=([^"&\s]+)/);
    expect(match![1]).toBe("abc-def_ghi");
  });
});

// ─── Reset template ───────────────────────────────────────────────────────────

describe("buildResetEmail", () => {
  const resetUrl = "https://app.kanon.dev/reset-password?token=resetTok456";

  it("returns correct subject containing Reset", () => {
    const { subject } = buildResetEmail({ resetUrl });
    expect(subject).toContain("Reset");
  });

  it("returns HTML containing the token query param", () => {
    const { html } = buildResetEmail({ resetUrl });
    // existing integration test regex: /token=([^"&\s]+)/
    const match = html.match(/token=([^"&\s]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("resetTok456");
  });

  it("returns HTML with reset-password in href (ConsoleProvider regex)", () => {
    const { html } = buildResetEmail({ resetUrl });
    // ConsoleProvider regex: /href="([^"]*reset-password[^"]*)"/
    const match = html.match(/href="([^"]*reset-password[^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("reset-password");
  });

  it("returns a non-empty plaintext alternative containing the URL", () => {
    const { text } = buildResetEmail({ resetUrl });
    expect(text).toBeTruthy();
    expect(text).toContain(resetUrl);
  });

  it("uses actual 1-hour expiry label, not 30 minutes", () => {
    const { html } = buildResetEmail({ resetUrl });
    expect(html).toContain("1 hour");
    expect(html).not.toContain("30 min");
  });

  it("renders warn tone eyebrow", () => {
    const { html } = buildResetEmail({ resetUrl });
    expect(html).toContain("#B5621D"); // warn color
  });

  // Triangulation: different token shape
  it("handles base64url tokens (contains - and _) without breaking regex", () => {
    const url = "https://app.kanon.dev/reset-password?token=a1B2-cD_eF";
    const { html } = buildResetEmail({ resetUrl: url });
    const match = html.match(/token=([^"&\s]+)/);
    expect(match![1]).toBe("a1B2-cD_eF");
    const hrefMatch = html.match(/href="([^"]*reset-password[^"]*)"/);
    expect(hrefMatch).not.toBeNull();
  });
});

// ─── Invite template ──────────────────────────────────────────────────────────

describe("buildInviteEmail", () => {
  const baseOpts = {
    workspaceName: "Acme Corp",
    role: "member",
    inviterName: "Anya Petrova",
    inviteUrl: "https://app.kanon.dev/invite/invTok789",
    expiresAt: new Date("2026-06-10T00:00:00Z"),
  };

  it("returns subject with workspace name", () => {
    const { subject } = buildInviteEmail(baseOpts);
    expect(subject).toContain("Acme Corp");
  });

  it("returns HTML with invite path (not ?token= query param)", () => {
    const { html } = buildInviteEmail(baseOpts);
    expect(html).toContain("/invite/invTok789");
  });

  it("returns HTML containing the inviter name", () => {
    const { html } = buildInviteEmail(baseOpts);
    expect(html).toContain("Anya Petrova");
  });

  it("returns HTML containing the role label", () => {
    const { html } = buildInviteEmail(baseOpts);
    expect(html.toLowerCase()).toContain("member");
  });

  it("returns HTML containing expiry date derived from expiresAt", () => {
    const { html } = buildInviteEmail(baseOpts);
    // Should render a human date, not hardcode "7 days"
    expect(html).toContain("June");
  });

  it("returns HTML with Accept invitation CTA href", () => {
    const { html } = buildInviteEmail(baseOpts);
    expect(html).toContain('href="https://app.kanon.dev/invite/invTok789"');
  });

  it("returns a non-empty plaintext alternative containing the URL", () => {
    const { text } = buildInviteEmail(baseOpts);
    expect(text).toBeTruthy();
    expect(text).toContain("https://app.kanon.dev/invite/invTok789");
  });

  // Triangulation: owner role and different workspace name
  it("capitalizes the role label correctly", () => {
    const { html } = buildInviteEmail({ ...baseOpts, role: "owner", workspaceName: "Beta Inc" });
    expect(html).toContain("Beta Inc");
    expect(html.toLowerCase()).toContain("owner");
  });

  // Security: HTML injection prevention — user-controlled values must be escaped
  it("escapes HTML special chars in workspaceName to prevent injection", () => {
    const { html } = buildInviteEmail({
      ...baseOpts,
      workspaceName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
  });

  it("escapes HTML special chars in inviterName to prevent injection", () => {
    const { html } = buildInviteEmail({
      ...baseOpts,
      inviterName: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML special chars in role to prevent injection", () => {
    const { html } = buildInviteEmail({
      ...baseOpts,
      role: 'admin"><a href="http://evil.example">click',
    });
    expect(html).not.toContain('"><a href=');
    expect(html).toContain("&gt;");
    expect(html).toContain("&lt;a");
  });
});
