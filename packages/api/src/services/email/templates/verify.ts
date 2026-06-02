import { renderEmailLayout } from "../layout.js";

const E_ai = "#7755FF";
const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_bg2 = "#F8F8F6";
const E_line = "#E6E6E2";
const E_mono = "'Courier New',Courier,monospace";
const E_sans = "Arial,Helvetica,sans-serif";
const E_ink4 = "#A6ABB0";
const E_ink = "#0E1011";

export interface BuildVerifyEmailOptions {
  verifyUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the HTML/text email for email address verification (KAN-30 / MailWelcome).
 *
 * Maps to design's MailWelcome:
 *   - Eyebrow: "Step 1 of 2 — verify"
 *   - Serif italic H1
 *   - Primary CTA with verifyUrl (MUST preserve ?token= query param for test regexes)
 *   - Paste-link fallback CodeBlock
 *   - "What's next" 3-step list
 *   - 24h expiry note
 */
export function buildVerifyEmail(opts: BuildVerifyEmailOptions): EmailContent {
  const { verifyUrl } = opts;

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      Thanks for signing up. Click below to verify this address.
      The link is good for <strong>24 hours</strong> and only works once.
    </p>`;

  const whatNextHtml = `
    <div style="padding:20px 32px 24px;">
      <p style="margin:0 0 4px;font-family:${E_mono};font-size:10px;color:${E_ai};letter-spacing:0.1em;text-transform:uppercase;">
        What&#8217;s next
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
        ${[
          ["Connect your repo", "GitHub, GitLab, or self-hosted. Read-only by default."],
          ["Plug in MCP", "Claude reads your roadmap and writes back via MCP. No keys to manage."],
          ["Invite your team", "Roles map to SAML groups if you have SSO."],
        ]
          .map(
            ([title, desc], i) => `
        <tr>
          <td width="24" valign="top" style="padding-top:12px;font-family:${E_mono};font-size:11px;color:${E_ink4};">0${i + 1}</td>
          <td style="padding-top:12px;">
            <div style="font-family:${E_sans};font-size:13px;font-weight:600;color:${E_ink};">${title}</div>
            <div style="font-family:${E_sans};font-size:12px;color:${E_ink3};margin-top:2px;line-height:1.5;">${desc}</div>
          </td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>`;

  const html = renderEmailLayout({
    eyebrow: "Step 1 of 2 — verify",
    eyebrowTone: "default",
    heading: "Confirm your email,<br/>then we&#8217;ll spin up your workspace.",
    bodyHtml,
    cta: { label: "Verify email →", href: verifyUrl },
    linkFallback: verifyUrl,
    extraSectionHtml: whatNextHtml,
    disclaimerText:
      "Didn&#8217;t sign up? You can ignore this — the email won&#8217;t be activated. We never share your address.",
  });

  const text = [
    "Step 1 of 2 — Verify your email",
    "",
    "Thanks for signing up. Click below to verify this address.",
    "The link is good for 24 hours and only works once.",
    "",
    "Verify your email:",
    verifyUrl,
    "",
    "What's next:",
    "01  Connect your repo — GitHub, GitLab, or self-hosted.",
    "02  Plug in MCP — Claude reads your roadmap via MCP.",
    "03  Invite your team — Roles map to SAML groups if you have SSO.",
    "",
    "Kanon · 1 Cromwell Pl, London",
    "Didn't sign up? You can ignore this email.",
  ].join("\n");

  return {
    subject: "Verify your email",
    html,
    text,
  };
}
