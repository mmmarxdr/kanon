import { renderEmailLayout } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

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
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
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
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). Structure, URLs, and test-critical patterns
 * (verifyUrl href with ?token=) are unaffected by locale.
 */
export function buildVerifyEmail(opts: BuildVerifyEmailOptions): EmailContent {
  const { verifyUrl } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string) => emailT(locale, key);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      ${t("verify.bodyIntro")}
      ${t("verify.bodyExpiry")}
    </p>`;

  const whatNextHtml = `
    <div style="padding:20px 32px 24px;">
      <p style="margin:0 0 4px;font-family:${E_mono};font-size:10px;color:${E_ai};letter-spacing:0.1em;text-transform:uppercase;">
        ${t("verify.whatsNextLabel")}
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
        ${[
          [t("verify.step1Title"), t("verify.step1Desc")],
          [t("verify.step2Title"), t("verify.step2Desc")],
          [t("verify.step3Title"), t("verify.step3Desc")],
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
    eyebrow: t("verify.eyebrow"),
    eyebrowTone: "default",
    heading: t("verify.heading"),
    bodyHtml,
    cta: { label: t("verify.ctaLabel"), href: verifyUrl },
    linkFallback: verifyUrl,
    extraSectionHtml: whatNextHtml,
    disclaimerText: t("verify.disclaimer"),
  });

  const text = [
    t("verify.textTitle"),
    "",
    t("verify.textBody1"),
    t("verify.textBody2"),
    "",
    t("verify.textCta"),
    verifyUrl,
    "",
    t("verify.textWhatsNext"),
    t("verify.textStep1"),
    t("verify.textStep2"),
    t("verify.textStep3"),
    "",
    "Kanon · 1 Cromwell Pl, London",
    t("verify.textDisclaimer"),
  ].join("\n");

  return {
    subject: t("verify.subject"),
    html,
    text,
  };
}
