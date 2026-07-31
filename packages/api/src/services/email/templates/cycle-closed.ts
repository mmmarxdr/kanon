import { renderEmailLayout, escapeHtml } from "../layout.js";
import type { EmailContent } from "../types.js";
import { emailT, DEFAULT_EMAIL_LOCALE, type EmailLocale } from "../i18n/messages.js";

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
  /** Instance email locale (KAN-203 Slice 2). Defaults to "en". */
  locale?: EmailLocale;
}

/**
 * Build the HTML/text email for a cycle-closed report.
 *
 * Sent to all opted-in project members (actor included — locked decision, D5).
 * Pure function: no side-effects, just returns { subject, html, text }.
 * Security: user-controlled strings are HTML-escaped before interpolation.
 *
 * Copy is localized via emailT() from `../i18n/messages.js` using the instance's
 * `defaultLocale` (KAN-203 Slice 2). eyebrow/heading receive RAW values because
 * renderEmailLayout escapes those fields itself — bodyHtml receives the
 * pre-escaped safe* values since it bypasses that escaping.
 */
export function buildCycleClosedEmail(opts: BuildCycleClosedEmailOptions): EmailContent {
  const { cycleName, projectName, projectKey, velocity, completed, planned, scopeAdded, scopeRemoved, appUrl } = opts;
  const locale = opts.locale ?? DEFAULT_EMAIL_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => emailT(locale, key, vars);

  // safe* variables: HTML-escaped user-controlled strings — safe to interpolate into HTML.
  // Numeric fields (velocity, completed, planned, scopeAdded, scopeRemoved) are
  // interpolated raw — they are typed as number and cannot contain HTML injection.
  // Raw string variables (cycleName, projectName, projectKey) are passed only to
  // renderEmailLayout opts (eyebrow, heading, subject) which escape them internally,
  // or to the plain-text fallback (no HTML context).
  const safeCycleName = escapeHtml(cycleName);
  const safeProjectName = escapeHtml(projectName);
  const safeProjectKey = escapeHtml(projectKey);

  const completionRate = planned > 0 ? Math.round((completed / planned) * 100) : 0;

  const bodyHtml = `
    <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#3A3D40;letter-spacing:-0.005em;">
      ${t("cycleClosed.bodyIntro", {
        cycleName: safeCycleName,
        projectName: safeProjectName,
        projectKey: safeProjectKey,
      })}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
           style="margin:16px 0 0;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 14px;background:#F8F8F6;border:1px solid #E6E6E2;border-radius:4px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;padding-bottom:4px;">
                ${t("cycleClosed.statVelocityLabel")}
              </td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:700;color:#0E1011;padding-bottom:4px;">
                ${velocity}
              </td>
            </tr>
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;padding-bottom:4px;">
                ${t("cycleClosed.statCompletedLabel")}
              </td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:14px;color:#1F7A49;padding-bottom:4px;">
                ${completed} / ${planned} (${completionRate}%)
              </td>
            </tr>
            ${scopeAdded > 0 || scopeRemoved > 0 ? `<tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71757A;">
                ${t("cycleClosed.statScopeLabel")}
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
    eyebrow: t("cycleClosed.eyebrow", { projectKey }),
    eyebrowTone: "ok",
    heading: t("cycleClosed.heading", { cycleName }),
    bodyHtml,
    cta: { label: t("cycleClosed.ctaLabel"), href: `${appUrl}` },
    disclaimerText: t("cycleClosed.disclaimer", { appUrl }),
  });

  const scopeLine =
    scopeAdded > 0 || scopeRemoved > 0
      ? [t("cycleClosed.textScopeChanges", { added: scopeAdded, removed: scopeRemoved })]
      : [];

  const text = [
    t("cycleClosed.textTitle", { cycleName, projectName, projectKey }),
    "",
    t("cycleClosed.textVelocity", { velocity }),
    t("cycleClosed.textCompleted", { completed, planned, rate: completionRate }),
    ...scopeLine,
    "",
    t("cycleClosed.textViewProject", { appUrl }),
    "",
    t("cycleClosed.textManage", { appUrl }),
    "",
    "Kanon · 1 Cromwell Pl, London",
  ].join("\n");

  return {
    subject: t("cycleClosed.subject", { cycleName }),
    html,
    text,
  };
}
