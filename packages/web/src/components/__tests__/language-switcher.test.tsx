import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { LanguageSwitcher } from "../language-switcher";
import { AppTopbar } from "../app-topbar";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/inbox" }),
}));

vi.mock("@/stores/command-palette-store", () => ({
  useCommandPaletteStore: Object.assign(
    (selector: (s: { open: () => void; requestCreateIssue: () => void }) => unknown) =>
      selector({ open: vi.fn(), requestCreateIssue: vi.fn() }),
    { getState: () => ({ requestCreateIssue: vi.fn() }) },
  ),
}));

vi.mock("@/stores/theme-store", () => ({
  useThemeStore: (selector: (s: { appearance: string; toggleAppearance: () => void }) => unknown) =>
    selector({ appearance: "dark", toggleAppearance: vi.fn() }),
}));

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    Sun: () => <span data-testid="icon-sun" />,
    Moon: () => <span data-testid="icon-moon" />,
    Search: () => <span data-testid="icon-search" />,
    Plus: () => <span data-testid="icon-plus" />,
  },
}));

vi.mock("@/components/ui/primitives", () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
}));

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders current locale code and toggles to es", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSwitcher />
      </I18nextProvider>,
    );
    const btn = screen.getByTestId("language-switcher");
    expect(btn).toHaveTextContent("EN");
    fireEvent.click(btn);
    expect(i18n.language).toMatch(/^es/);
  });
});

describe("AppTopbar LanguageSwitcher placement", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("places language switcher before theme toggle", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <AppTopbar />
      </I18nextProvider>,
    );
    const lang = screen.getByTestId("language-switcher");
    const themeBtn = container.querySelector("button[title*='light'], button[title*='dark'], button[title*='claro'], button[title*='oscuro']");
    // Theme button is the one with sun/moon icon
    const buttons = Array.from(container.querySelectorAll("header button"));
    const langIdx = buttons.indexOf(lang);
    const themeIdx = buttons.findIndex((b) => b.querySelector("[data-testid='icon-sun'], [data-testid='icon-moon']"));
    expect(langIdx).toBeGreaterThanOrEqual(0);
    expect(themeIdx).toBeGreaterThan(langIdx);
  });
});
