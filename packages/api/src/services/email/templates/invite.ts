import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

export type { EmailContent };

const E_ink2 = "#3A3D40";
const E_ink3 = "#71757A";
const E_sans = "Arial,Helvetica,sans-serif";

export interface BuildInviteEmailOptions {
  workspaceName: string;
  role: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
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
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). eyebrow/heading receive the RAW (unescaped)
 * workspaceName/inviterName because renderEmailLayout escapes those fields itself
 * — bodyHtml receives the pre-escaped safe* values since it bypasses that escaping.
 */
export function buildInviteEmail(opts: BuildInviteEmailOptions): EmailContent {
  const { workspaceName, role, inviterName, inviteUrl, expiresAt } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => emailT(locale, key, vars);

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  const expiresDate = expiresAt.toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeRoleLabel = escapeHtml(roleLabel);

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:14px;line-height:1.55;color:${E_ink2};letter-spacing:-0.005em;">
      ${t("invite.bodyIntro", { workspace: safeWorkspaceName, role: safeRoleLabel })}
    </p>
    <p style="margin:10px 0 0;font-family:${E_sans};font-size:12px;line-height:1.5;color:${E_ink3};">
      ${t("invite.bodyExpiry", { date: expiresDate })}
    </p>`;

  const html = renderEmailLayout({
    eyebrow: t("invite.eyebrow", { workspace: workspaceName }),
    eyebrowTone: "default",
    heading: t("invite.heading", { inviter: inviterName, workspace: workspaceName }),
    bodyHtml,
    cta: { label: t("invite.ctaLabel"), href: inviteUrl },
    disclaimerText: t("invite.disclaimer"),
  });

  const text = [
    t("invite.textSubjectLine", { workspace: workspaceName }),
    "",
    t("invite.textBody", { inviter: inviterName, workspace: workspaceName, role: roleLabel }),
    "",
    t("invite.textCta"),
    inviteUrl,
    "",
    t("invite.textExpiry", { date: expiresDate }),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("invite.subject", { workspace: workspaceName }),
    html,
    text,
  };
}
