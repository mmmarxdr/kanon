import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

export interface BuildAssignmentEmailOptions {
  assignedByName: string;
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  appUrl: string;
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
}

/**
 * Build the HTML/text email for an issue assignment notification.
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
export function buildAssignmentEmail(opts: BuildAssignmentEmailOptions): EmailContent {
  const { assignedByName, issueKey, issueTitle, issueUrl, appUrl } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => emailT(locale, key, vars);

  // safe* variables: HTML-escaped user-controlled strings — safe to interpolate into HTML.
  // Raw variables are passed only to renderEmailLayout opts (eyebrow, heading) which
  // apply escapeHtml internally, or to the plain-text fallback (no HTML context).
  const safeAssignedByName = escapeHtml(assignedByName);
  const safeIssueKey = escapeHtml(issueKey);
  const safeIssueTitle = escapeHtml(issueTitle);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      <!-- safe* interpolations: HTML-escaped above -->
      ${t("assignment.bodyHtml", {
        assignedByName: safeAssignedByName,
        issueKey: safeIssueKey,
        issueTitle: safeIssueTitle,
      })}
    </p>`;

  const html = renderEmailLayout({
    // Raw strings passed here: renderEmailLayout runs escapeHtml on eyebrow + heading internally
    eyebrow: t("assignment.eyebrow", { issueKey }),
    eyebrowTone: "ok",
    heading: t("assignment.heading", { assignedByName }),
    bodyHtml,
    cta: { label: t("assignment.ctaLabel"), href: issueUrl },
    disclaimerText: t("assignment.disclaimer", { appUrl }),
  });

  const text = [
    t("assignment.textLine1", { assignedByName, issueKey, issueTitle }),
    "",
    t("assignment.textCta"),
    issueUrl,
    "",
    t("assignment.textManage", { appUrl }),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("assignment.subject", { issueKey }),
    html,
    text,
  };
}
