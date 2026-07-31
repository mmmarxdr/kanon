import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

export interface BuildMentionEmailOptions {
  mentionedByName: string;
  issueKey: string;
  issueTitle: string;
  context: string;
  issueUrl: string;
  appUrl: string;
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
}

/**
 * Build the HTML/text email for a @mention notification.
 *
 * Pure function: no side-effects, just returns { subject, html, text }.
 * Follows the invite.ts + renderEmailLayout pattern.
 * Security: user-controlled strings are HTML-escaped before interpolation.
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). eyebrow/heading receive RAW values because
 * renderEmailLayout escapes those fields itself — bodyHtml receives the
 * pre-escaped safe* values since it bypasses that escaping.
 */
export function buildMentionEmail(opts: BuildMentionEmailOptions): EmailContent {
  const { mentionedByName, issueKey, issueTitle, context, issueUrl, appUrl } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => emailT(locale, key, vars);

  // safe* variables: HTML-escaped user-controlled strings — safe to interpolate into HTML.
  // Raw variables (mentionedByName, issueKey, etc.) are used only in:
  //   - the text fallback (plain text, no HTML context), or
  //   - renderEmailLayout opts that are themselves escaped inside renderEmailLayout
  //     (eyebrow, heading are always run through escapeHtml there).
  const safeMentionedByName = escapeHtml(mentionedByName);
  const safeIssueKey = escapeHtml(issueKey);
  const safeIssueTitle = escapeHtml(issueTitle);
  const safeContext = escapeHtml(context);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      <!-- safe* interpolations: HTML-escaped above -->
      ${t("mention.bodyHtml", {
        mentionedByName: safeMentionedByName,
        issueKey: safeIssueKey,
        issueTitle: safeIssueTitle,
      })}
    </p>
    <p style="margin:10px 0 0;font-family:'Courier New',Courier,monospace;font-size:12px;padding:10px 14px;background:#F8F8F6;border:1px solid #D5D5D0;border-radius:4px;color:#3A3D40;word-break:break-word;">
      <!-- safeContext: user comment snippet — HTML-escaped above -->
      ${safeContext}
    </p>`;

  const html = renderEmailLayout({
    // Raw strings passed here: renderEmailLayout runs escapeHtml on eyebrow + heading internally
    eyebrow: t("mention.eyebrow", { issueKey }),
    eyebrowTone: "default",
    heading: t("mention.heading", { mentionedByName }),
    bodyHtml,
    cta: { label: t("mention.ctaLabel"), href: issueUrl },
    disclaimerText: t("mention.disclaimer", { appUrl }),
  });

  const text = [
    t("mention.textLine1", { mentionedByName, issueKey, issueTitle }),
    "",
    `"${context}"`,
    "",
    t("mention.textCta"),
    issueUrl,
    "",
    t("mention.textManage", { appUrl }),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("mention.subject", { mentionedByName, issueKey }),
    html,
    text,
  };
}
