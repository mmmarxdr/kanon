import { renderEmailLayout } from "../layout.js";
import type { EmailContent } from "../types.js";

export type { EmailContent };

const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_sans = "Arial,Helvetica,sans-serif";

export interface BuildMagicLinkEmailOptions {
  url: string;
}

/**
 * Build the HTML/text email for magic-link sign-in (KAN-9).
 *
 * CRITICAL: url must appear as href="...magic-link..." with /magic-link?token=
 * in the path so that ConsoleProvider's capture regex can extract it:
 *   /href="([^"]*magic-link[^"]*)"/
 */
export function buildMagicLinkEmail(opts: BuildMagicLinkEmailOptions): EmailContent {
  const { url } = opts;

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      Click the button below to sign in to Kanon. No password needed.
      If you didn&#8217;t request this, you can safely ignore this email.
    </p>
    <p style="margin:8px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      The link expires <strong style="color:${E_ink2};">15 minutes</strong> from request.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: "Magic link · 15 minutes",
    eyebrowTone: "default",
    heading: "Sign in to Kanon.",
    bodyHtml,
    cta: { label: "Sign in →", href: url },
    disclaimerText:
      "If you didn&#8217;t request a sign-in link, no action is needed. This link will expire shortly.",
  });

  const text = [
    "Kanon sign-in link",
    "",
    "Click the link below to sign in. No password needed.",
    "If you didn't request this, ignore this email.",
    "",
    "Sign in:",
    url,
    "",
    "This link expires in 15 minutes.",
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: "Your Kanon sign-in link",
    html,
    text,
  };
}
