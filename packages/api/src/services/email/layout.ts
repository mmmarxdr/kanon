/**
 * Email layout renderer — shared 600px card on #F4F4F2 background.
 *
 * Approach A: hand-written TABLE-based HTML with fully inline styles.
 * Zero new dependencies. Email-client safe (Outlook, Gmail, Apple Mail).
 *
 * Design token source: kanon-emails.jsx (Claude Design handoff, bundle
 * dsd_R2fwAJLe2NZPqeq1OA). Palette prefix E.*.
 */

// ─── Brand tokens (email — light mode, distinct from app dark theme) ──────────
const E = {
  bg: "#F4F4F2",
  card: "#FFFFFF",
  ink: "#0E1011",
  ink2: "#3A3D40",
  ink3: "#71757A",
  ink4: "#A6ABB0",
  line: "#E6E6E2",
  line2: "#D5D5D0",
  bg2: "#F8F8F6",
  accent: "#1D4FD8",
  warn: "#B5621D",
  warnSoft: "#F8ECDF",
  ok: "#1F7A49",
  bad: "#B43232",
  ai: "#7755FF",
  // Font fallbacks (email-safe — no Google Fonts link)
  serif: "Georgia,'Times New Roman',serif",
  sans: "Arial,Helvetica,sans-serif",
  mono: "'Courier New',Courier,monospace",
};

/**
 * Escape user-controlled strings before interpolating them into HTML.
 * Replacement order matters: & must come first to avoid double-encoding.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EyebrowTone = "default" | "warn" | "ok" | "bad" | "ai";

export interface RenderEmailLayoutOptions {
  /** Mono uppercase label above the heading (e.g. "Step 1 of 2 — verify") */
  eyebrow: string;
  /** Color tone for the eyebrow */
  eyebrowTone: EyebrowTone;
  /** Main serif italic headline */
  heading: string;
  /** Pre-built body HTML injected into the card (use plain string literals) */
  bodyHtml: string;
  /** Primary CTA button */
  cta: { label: string; href: string };
  /** Optional "paste this link" fallback URL displayed below the CTA */
  linkFallback?: string;
  /** Optional additional section HTML appended above the footer disclaimer */
  extraSectionHtml?: string;
  /**
   * Optional disclaimer text in the bg2 footer strip.
   * @raw — injected as-is into the HTML template without escaping.
   * Caller is responsible for ensuring this does NOT contain user-controlled
   * input. Contrast with `eyebrow` / `heading`, which are always run through
   * `escapeHtml` inside `renderEmailLayout`. Do NOT pass user-controlled
   * strings here without pre-escaping.
   */
  disclaimerText?: string;
}

function eyebrowColor(tone: EyebrowTone): string {
  switch (tone) {
    case "warn": return E.warn;
    case "ok":   return E.ok;
    case "bad":  return E.bad;
    case "ai":   return E.ai;
    default:     return E.ink4;
  }
}

function headerTagLabel(tone: EyebrowTone): string {
  switch (tone) {
    case "ai":   return "AGENT";
    case "warn":  return "ALERT";
    case "ok":   return "REPORT";
    case "bad":  return "CRITICAL";
    default:     return "AUTH";
  }
}

/**
 * Render the shared email card layout.
 * Returns a full HTML document string with all styles inlined.
 * No <style> block, no Google Fonts link, no flex/grid/SVG.
 *
 * Intentional: this function does NOT strip or replace `<br>` tags from
 * caller-supplied `bodyHtml`. The `bodyHtml` field is trusted pre-built HTML;
 * stripping would corrupt line-breaks intentionally inserted by templates.
 * User-controlled data must be escaped via `escapeHtml` BEFORE being placed
 * in `bodyHtml` — it is never passed raw through this renderer.
 */
export function renderEmailLayout(opts: RenderEmailLayoutOptions): string {
  const {
    eyebrow: eyebrowRaw,
    eyebrowTone,
    heading: headingRaw,
    bodyHtml,
    cta,
    linkFallback,
    extraSectionHtml = "",
    disclaimerText = "If you didn't expect this, you can safely ignore this email. We never share your address.",
  } = opts;

  // Always escape heading and eyebrow — they may contain user-controlled data.
  // Templates that previously pre-escaped these values will produce double-encoding;
  // those callers must pass the raw (unescaped) string and let this function escape.
  const eyebrow = escapeHtml(eyebrowRaw);
  const heading = escapeHtml(headingRaw);

  const eyeColor = eyebrowColor(eyebrowTone);
  const tagLabel = headerTagLabel(eyebrowTone);

  const linkFallbackHtml = linkFallback
    ? `
      <tr>
        <td style="padding:0 32px 16px;">
          <p style="margin:0 0 8px;font-family:${E.sans};font-size:12px;line-height:1.5;color:${E.ink3};">
            Or paste this link into your browser:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>
              <td style="font-family:${E.mono};font-size:12px;padding:12px 14px;background:${E.bg2};border:1px solid ${E.line};border-radius:5px;color:${E.ink2};letter-spacing:0.02em;word-break:break-all;">
                ${linkFallback}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const extraHtml = extraSectionHtml
    ? `<tr><td>${extraSectionHtml}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${E.bg};font-family:${E.sans};">
  <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" width="720" role="presentation"><tr><td><![endif]-->
  <table align="center" width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
         style="max-width:720px;margin:0 auto;background:${E.bg};padding:28px;">
    <tr>
      <td align="center">

        <!-- ── Email card ─────────────────────────────────────────────── -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="width:600px;background:${E.card};border:1px solid ${E.line};border-radius:8px;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="padding:20px 32px;border-bottom:1px solid ${E.line};">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td style="font-family:${E.sans};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:${E.ink};">
                    ◆&nbsp;Kanon
                  </td>
                  <td align="right" style="font-family:${E.mono};font-size:10px;color:${E.ink4};letter-spacing:0.06em;text-transform:uppercase;">
                    ${tagLabel}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Eyebrow + Heading + Body -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <p style="margin:0 0 10px;font-family:${E.mono};font-size:10px;color:${eyeColor};letter-spacing:0.1em;text-transform:uppercase;">
                ${eyebrow}
              </p>
              <h1 style="margin:0;font-family:${E.serif};font-weight:400;font-style:italic;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:${E.ink};">
                ${heading}
              </h1>
              ${bodyHtml}
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:20px 32px 8px;">
              <table cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td style="border-radius:5px;background:${E.ink};">
                    <a href="${cta.href}"
                       style="display:inline-block;padding:11px 20px;font-family:${E.sans};font-size:14px;font-weight:600;letter-spacing:-0.005em;color:#ffffff;text-decoration:none;border-radius:5px;background:${E.ink};border:1px solid ${E.ink};">
                      ${cta.label}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${linkFallbackHtml}

          <!-- Divider -->
          <tr>
            <td style="padding:4px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td style="height:1px;background:${E.line};margin:0 32px;"></td>
                </tr>
              </table>
            </td>
          </tr>

          ${extraHtml}

          <!-- Disclaimer strip -->
          <tr>
            <td style="padding:14px 32px 22px;background:${E.bg2};border-top:1px solid ${E.line};">
              <p style="margin:0;font-family:${E.sans};font-size:11px;line-height:1.55;color:${E.ink3};">
                ${disclaimerText}
              </p>
            </td>
          </tr>

        </table>
        <!-- ── End card ───────────────────────────────────────────────── -->

        <!-- Footer meta -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="width:600px;margin:12px auto 0;">
          <tr>
            <td align="center" style="font-family:${E.mono};font-size:10px;color:${E.ink4};letter-spacing:0.04em;text-align:center;">
              Kanon &middot; 1 Cromwell Pl, London &middot;
              <a href="#unsubscribe" style="color:${E.ink4};text-decoration:underline;">Unsubscribe</a> &middot;
              <a href="#notifications" style="color:${E.ink4};text-decoration:underline;">Manage notifications</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
  <!--[if mso | IE]></td></tr></table><![endif]-->
</body>
</html>`;
}
