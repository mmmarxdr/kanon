import { renderEmailLayout } from "../layout.js";
import type { EmailContent } from "../types.js";

export type { EmailContent };

const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_ink = "#0E1011";
const E_bg2 = "#F8F8F6";
const E_line = "#E6E6E2";
const E_sans = "Arial,Helvetica,sans-serif";

export interface BuildResetEmailOptions {
  resetUrl: string;
}

/**
 * Build the HTML/text email for password reset (MailReset).
 *
 * Maps to design's MailReset:
 *   - Warn eyebrow tone (#B5621D)
 *   - Eyebrow: "Password reset · 1 hour" (code uses 1h, NOT design's "30 min")
 *   - Primary CTA with resetUrl (MUST preserve ?token= query param)
 *   - MUST have href="...reset-password..." for ConsoleProvider regex
 *   - Account safety tips
 *
 * CRITICAL: resetUrl must appear as href="<url>" with reset-password in the path
 * so that ConsoleProvider's regex /href="([^"]*reset-password[^"]*)"/ matches.
 * And /token=([^"&\s]+)/ must extract the token from the URL.
 */
export function buildResetEmail(opts: BuildResetEmailOptions): EmailContent {
  const { resetUrl } = opts;

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      Someone asked to reset the password for this account.
      If that wasn&#8217;t you, ignore this — your password stays as it is.
    </p>
    <p style="margin:8px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      The link expires <strong style="color:${E_ink2};">1 hour</strong> from request.
      If it&#8217;s stale, just request a new one.
    </p>`;

  const safetyHtml = `
    <div style="padding:18px 32px 8px;background:${E_bg2};">
      <p style="margin:0 0 4px;font-family:'Courier New',Courier,monospace;font-size:10px;color:#71757A;letter-spacing:0.1em;text-transform:uppercase;">
        Account safety
      </p>
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:4px;">
        ${[
          "Use a passphrase, not a single word.",
          "Turn on 2FA — Settings → Security.",
          "Revoke any session that wasn&#8217;t yours.",
        ]
          .map(
            (tip) => `
        <tr>
          <td width="12" valign="top" style="padding-top:8px;padding-right:10px;">
            <span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:${E_ink};margin-top:5px;">&nbsp;</span>
          </td>
          <td style="padding-top:8px;font-family:${E_sans};font-size:13px;color:${E_ink2};line-height:1.5;">${tip}</td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>
    <div style="padding:14px 32px 22px;background:${E_bg2};border-top:1px solid ${E_line};">
      <p style="margin:0;font-family:${E_sans};font-size:11px;line-height:1.55;color:${E_ink3};">
        Need help? Reply to this email — a human will get back to you.
      </p>
    </div>`;

  const html = renderEmailLayout({
    eyebrow: "Password reset · 1 hour",
    eyebrowTone: "warn",
    heading: "Reset your password.",
    bodyHtml,
    cta: { label: "Choose a new password →", href: resetUrl },
    extraSectionHtml: safetyHtml,
    disclaimerText:
      "If you didn&#8217;t request a password reset, no action is needed. Your password has not been changed.",
  });

  const text = [
    "Password reset",
    "",
    "Someone asked to reset the password for this account.",
    "If that wasn't you, ignore this — your password stays as it is.",
    "",
    "Reset your password:",
    resetUrl,
    "",
    "This link expires in 1 hour.",
    "",
    "Account safety tips:",
    "- Use a passphrase, not a single word.",
    "- Turn on 2FA — Settings → Security.",
    "- Revoke any session that wasn't yours.",
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: "Reset your password",
    html,
    text,
  };
}
