import { renderEmailLayout } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_ink = "#0E1011";
const E_bg2 = "#F8F8F6";
const E_line = "#E6E6E2";
const E_sans = "Arial,Helvetica,sans-serif";

export interface BuildResetEmailOptions {
  resetUrl: string;
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
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
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). The "1 hour" expiry copy and reset-password
 * URL structure are unaffected by locale.
 */
export function buildResetEmail(opts: BuildResetEmailOptions): EmailContent {
  const { resetUrl } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string) => emailT(locale, key);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      ${t("reset.body1")}
    </p>
    <p style="margin:8px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      ${t("reset.body2")}
    </p>`;

  const safetyHtml = `
    <div style="padding:18px 32px 8px;background:${E_bg2};">
      <p style="margin:0 0 4px;font-family:'Courier New',Courier,monospace;font-size:10px;color:#71757A;letter-spacing:0.1em;text-transform:uppercase;">
        ${t("reset.safetyLabel")}
      </p>
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:4px;">
        ${[t("reset.tip1"), t("reset.tip2"), t("reset.tip3")]
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
        ${t("reset.helpText")}
      </p>
    </div>`;

  const html = renderEmailLayout({
    eyebrow: t("reset.eyebrow"),
    eyebrowTone: "warn",
    heading: t("reset.heading"),
    bodyHtml,
    cta: { label: t("reset.ctaLabel"), href: resetUrl },
    extraSectionHtml: safetyHtml,
    disclaimerText: t("reset.disclaimer"),
  });

  const text = [
    t("reset.textTitle"),
    "",
    t("reset.textBody1"),
    t("reset.textBody2"),
    "",
    t("reset.textCta"),
    resetUrl,
    "",
    t("reset.textExpiry"),
    "",
    t("reset.textTipsLabel"),
    t("reset.textTip1"),
    t("reset.textTip2"),
    t("reset.textTip3"),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("reset.subject"),
    html,
    text,
  };
}
