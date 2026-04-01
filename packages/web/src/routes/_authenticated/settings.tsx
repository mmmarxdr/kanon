import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { useI18n } from "@/hooks/use-i18n";

export const settingsRoute = createRoute({
  path: "/settings",
  getParentRoute: () => authenticatedRoute,
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("settings.language.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.language.description")}
          </p>

          <div className="mt-4">
            <LocaleToggle />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("settings.appearance.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.appearance.description")}
          </p>

          <div className="mt-4">
            <ThemeToggle />
          </div>
        </section>
      </div>
    </div>
  );
}

