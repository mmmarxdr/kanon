import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES } from "@kanon/shared";

/**
 * Compact EN|ES control — cycles through SUPPORTED_LOCALES.
 * Place immediately left of the theme toggle in AppTopbar.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation("common");
  const current = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] ?? "en";
  const idx = Math.max(
    0,
    SUPPORTED_LOCALES.findIndex((l) => l.code === current),
  );
  const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length]!;
  const label =
    SUPPORTED_LOCALES.find((l) => l.code === current)?.code.toUpperCase() ?? "EN";

  return (
    <button
      type="button"
      data-testid="language-switcher"
      onClick={() => void i18n.changeLanguage(next.code)}
      title={t("language.switchTo")}
      aria-label={t("language.switchTo")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        color: "var(--ink-2)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      }}
    >
      {label}
    </button>
  );
}
