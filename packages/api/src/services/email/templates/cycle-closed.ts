import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";

export type { EmailContent };

export interface BuildCycleClosedEmailOptions {
  cycleName: string;
  projectName: string;
  projectKey: string;
  velocity: number;
  completed: number;
  planned: number;
  scopeAdded: number;
  scopeRemoved: number;
  appUrl: string;
}

/**
 * Build the HTML/text email for a cycle-closed report.
 *
 * Sent to all opted-in project members (actor included — locked decision, D5).
 * Pure function: no side-effects, just returns { subject, html, text }.
 * Security: user-controlled strings are HTML-escaped before interpolation.
 */
export function buildCycleClosedEmail(opts: BuildCycleClosedEmailOptions): EmailContent {
  const { cycleName, projectName, projectKey, velocity, completed, planned, scopeAdded, scopeRemoved, appUrl } = opts;

  const safeCycleName = escapeHtml(cycleName);
  const safeProjectName = escapeHtml(projectName);
  const safeProjectKey = escapeHtml(projectKey);

  const completionRate = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      The cycle <strong style="color:#0E1011;">${safeCycleName}</strong> in
      <strong style="color:#0E1011;">${safeProjectName}</strong> (${safeProjectKey}) has been closed.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
           style="margin:16px 0 0;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 14px;background:#F8F8F6;border:1px solid #E6E6E2;border-radius:4px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;padding-bottom:4px;">
                Velocity (story points)
              </td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:700;color:#0E1011;padding-bottom:4px;">
                ${velocity}
              </td>
            </tr>
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;padding-bottom:4px;">
                Issues completed
              </td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:14px;color:#1F7A49;padding-bottom:4px;">
                ${completed} / ${planned} (${completionRate}%)
              </td>
            </tr>
            ${scopeAdded > 0 || scopeRemoved > 0 ? `<tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;">
                Scope changes
              </td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:12px;color:#3A3D40;">
                +${scopeAdded} / −${scopeRemoved}
              </td>
            </tr>` : ""}
          </table>
        </td>
      </tr>
    </table>`;

  const html = renderEmailLayout({
    eyebrow: `Cycle closed · ${projectKey}`,
    eyebrowTone: "ok",
    heading: `${cycleName} is complete.`,
    bodyHtml,
    cta: { label: "View project →", href: `${appUrl}` },
    disclaimerText:
      `You received this cycle report as a project member. <a href="${appUrl}/settings/notifications" style="color:#71757A;">Manage notifications</a>.`,
  });

  const scopeLine =
    scopeAdded > 0 || scopeRemoved > 0
      ? [`Scope changes: +${scopeAdded} added / -${scopeRemoved} removed`]
      : [];

  const text = [
    `Cycle closed: ${cycleName} — ${projectName} (${projectKey})`,
    "",
    `Velocity: ${velocity} story points`,
    `Issues completed: ${completed} of ${planned} (${completionRate}%)`,
    ...scopeLine,
    "",
    `View project: ${appUrl}`,
    "",
    `Manage notifications: ${appUrl}/settings/notifications`,
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: `Cycle closed: ${cycleName}`,
    html,
    text,
  };
}
