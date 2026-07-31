import { renderEmailLayout } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_sans = "Arial,Helvetica,sans-serif";

export interface BuildMagicLinkEmailOptions {
  url: string;
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
}

/**
 * Build the HTML/text email for magic-link sign-in (KAN-9).
 *
 * CRITICAL: url must appear as href="...magic-link..." with /magic-link?token=
 * in the path so that ConsoleProvider's capture regex can extract it:
 *   /href="([^"]*magic-link[^"]*)"/
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). The href pattern is unaffected by locale.
 */
export function buildMagicLinkEmail(opts: BuildMagicLinkEmailOptions): EmailContent {
  const { url } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string) => emailT(locale, key);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      ${t("magicLink.body1")}
    </p>
    <p style="margin:8px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      ${t("magicLink.body2")}
    </p>`;

  const html = renderEmailLayout({
    eyebrow: t("magicLink.eyebrow"),
    eyebrowTone: "default",
    heading: t("magicLink.heading"),
    bodyHtml,
    cta: { label: t("magicLink.ctaLabel"), href: url },
    disclaimerText: t("magicLink.disclaimer"),
  });

  const text = [
    t("magicLink.textTitle"),
    "",
    t("magicLink.textBody1"),
    t("magicLink.textBody2"),
    "",
    t("magicLink.textCta"),
    url,
    "",
    t("magicLink.textExpiry"),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("magicLink.subject"),
    html,
    text,
  };
}
