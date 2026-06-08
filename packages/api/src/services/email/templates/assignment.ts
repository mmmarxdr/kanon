import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";

export type { EmailContent };

export interface BuildAssignmentEmailOptions {
  assignedByName: string;
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  appUrl: string;
}

/**
 * Build the HTML/text email for an issue assignment notification.
 *
 * Pure function: no side-effects, just returns { subject, html, text }.
 * Follows the invite.ts + renderEmailLayout pattern.
 * Security: user-controlled strings are HTML-escaped before interpolation.
 */
export function buildAssignmentEmail(opts: BuildAssignmentEmailOptions): EmailContent {
  const { assignedByName, issueKey, issueTitle, issueUrl, appUrl } = opts;

  const safeAssignedByName = escapeHtml(assignedByName);
  const safeIssueKey = escapeHtml(issueKey);
  const safeIssueTitle = escapeHtml(issueTitle);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      <strong style="color:#0E1011;">${safeAssignedByName}</strong> assigned you to
      <strong style="color:#0E1011;">${safeIssueKey}</strong> — ${safeIssueTitle}.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: `Assignment · ${issueKey}`,
    eyebrowTone: "ok",
    heading: `${assignedByName} assigned you an issue.`,
    bodyHtml,
    cta: { label: "View issue →", href: issueUrl },
    disclaimerText:
      `You received this because an issue was assigned to you. <a href="${appUrl}/settings/notifications" style="color:#71757A;">Manage notifications</a>.`,
  });

  const text = [
    `${assignedByName} assigned you to ${issueKey} — ${issueTitle}`,
    "",
    "View the issue:",
    issueUrl,
    "",
    `Manage notifications: ${appUrl}/settings/notifications`,
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: `You've been assigned to ${issueKey}`,
    html,
    text,
  };
}
