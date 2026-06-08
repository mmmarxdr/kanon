import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";

export type { EmailContent };

export interface BuildMentionEmailOptions {
  mentionedByName: string;
  issueKey: string;
  issueTitle: string;
  context: string;
  issueUrl: string;
  appUrl: string;
}

/**
 * Build the HTML/text email for a @mention notification.
 *
 * Pure function: no side-effects, just returns { subject, html, text }.
 * Follows the invite.ts + renderEmailLayout pattern.
 * Security: user-controlled strings are HTML-escaped before interpolation.
 */
export function buildMentionEmail(opts: BuildMentionEmailOptions): EmailContent {
  const { mentionedByName, issueKey, issueTitle, context, issueUrl, appUrl } = opts;

  const safeMentionedByName = escapeHtml(mentionedByName);
  const safeIssueKey = escapeHtml(issueKey);
  const safeIssueTitle = escapeHtml(issueTitle);
  const safeContext = escapeHtml(context);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      <strong style="color:#0E1011;">${safeMentionedByName}</strong> mentioned you in
      <strong style="color:#0E1011;">${safeIssueKey}</strong> — ${safeIssueTitle}.
    </p>
    <p style="margin:10px 0 0;font-family:'Courier New',Courier,monospace;font-size:12px;padding:10px 14px;background:#F8F8F6;border:1px solid #D5D5D0;border-radius:4px;color:#3A3D40;word-break:break-word;">
      ${safeContext}
    </p>`;

  const html = renderEmailLayout({
    eyebrow: `Mention · ${safeIssueKey}`,
    eyebrowTone: "default",
    heading: `${safeMentionedByName} mentioned you.`,
    bodyHtml,
    cta: { label: "View issue →", href: issueUrl },
    disclaimerText:
      `You received this because you were mentioned. <a href="${appUrl}/settings/notifications" style="color:#71757A;">Manage notifications</a>.`,
  });

  const text = [
    `${mentionedByName} mentioned you in ${issueKey} — ${issueTitle}`,
    "",
    `"${context}"`,
    "",
    "View the issue:",
    issueUrl,
    "",
    `Manage notifications: ${appUrl}/settings/notifications`,
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: `${mentionedByName} mentioned you in ${issueKey}`,
    html,
    text,
  };
}
