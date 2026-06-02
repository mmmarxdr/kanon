import { renderEmailLayout, escapeHtml } from "../layout.js";

const E_ink = "#0E1011";
const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_line = "#E6E6E2";
const E_line2 = "#D5D5D0";
const E_bg2 = "#F8F8F6";
const E_sans = "Arial,Helvetica,sans-serif";
const E_mono = "'Courier New',Courier,monospace";

export interface BuildInviteEmailOptions {
  workspaceName: string;
  role: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the HTML/text email for a workspace invite (MailInvite).
 *
 * Maps to design's MailInvite:
 *   - Eyebrow: "Invitation · {workspace}"
 *   - H1: "{inviter} invited you to Kanon · {workspace}"
 *   - Role chip (mono-styled span)
 *   - Accept invitation CTA (inviteUrl — path param /invite/:token, not ?token=)
 *   - Expiry from actual expiresAt date (NOT hardcoded "7 days")
 *
 * DEFERRED: inviter avatar card, teammate count, inviter subtitle.
 * Security: workspaceName, inviterName, and role are HTML-escaped via escapeHtml()
 * before interpolation into the HTML template (KAN-42 W1).
 */
export function buildInviteEmail(opts: BuildInviteEmailOptions): EmailContent {
  const { workspaceName, role, inviterName, inviteUrl, expiresAt } = opts;

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  const expiresDate = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeInviterName = escapeHtml(inviterName);
  const safeRoleLabel = escapeHtml(roleLabel);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      You&#8217;ve been invited to join
      <strong style="color:${E_ink};">${safeWorkspaceName}</strong> as a&#32;
      <span style="font-family:${E_mono};padding:1px 6px;border:1px solid ${E_line2};border-radius:3px;font-size:12px;color:${E_ink2};">${safeRoleLabel}</span>.
    </p>
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      This invite expires on <strong style="color:${E_ink2};">${expiresDate}</strong>.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: `Invitation · ${safeWorkspaceName}`,
    eyebrowTone: "default",
    heading: `${safeInviterName} invited you to<br/>Kanon · ${safeWorkspaceName}.`,
    bodyHtml,
    cta: { label: "Accept invitation →", href: inviteUrl },
    disclaimerText:
      "If you didn&#8217;t expect this invitation, you can safely ignore this email.",
  });

  const text = [
    `Invitation to ${workspaceName} on Kanon`,
    "",
    `${inviterName} has invited you to join ${workspaceName} as a ${roleLabel}.`,
    "",
    "Accept the invite:",
    inviteUrl,
    "",
    `This invite expires on ${expiresDate}.`,
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: `You've been invited to join ${workspaceName} on Kanon`,
    html,
    text,
  };
}
