import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@kanon/shared";

import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enInbox from "./locales/en/inbox.json";
import enBoard from "./locales/en/board.json";
import enIssue from "./locales/en/issue.json";
import enCycles from "./locales/en/cycles.json";
import enRoadmap from "./locales/en/roadmap.json";
import enSchedule from "./locales/en/schedule.json";
import enSettings from "./locales/en/settings.json";
import enPalette from "./locales/en/palette.json";
import enDependencies from "./locales/en/dependencies.json";
import enAuth from "./locales/en/auth.json";

import esCommon from "./locales/es/common.json";
import esNav from "./locales/es/nav.json";
import esInbox from "./locales/es/inbox.json";
import esBoard from "./locales/es/board.json";
import esIssue from "./locales/es/issue.json";
import esCycles from "./locales/es/cycles.json";
import esRoadmap from "./locales/es/roadmap.json";
import esSchedule from "./locales/es/schedule.json";
import esSettings from "./locales/es/settings.json";
import esPalette from "./locales/es/palette.json";
import esDependencies from "./locales/es/dependencies.json";
import esAuth from "./locales/es/auth.json";

export const I18N_NAMESPACES = [
  "common",
  "nav",
  "inbox",
  "board",
  "issue",
  "cycles",
  "roadmap",
  "schedule",
  "settings",
  "palette",
  "dependencies",
  "auth",
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    inbox: enInbox,
    board: enBoard,
    issue: enIssue,
    cycles: enCycles,
    roadmap: enRoadmap,
    schedule: enSchedule,
    settings: enSettings,
    palette: enPalette,
    dependencies: enDependencies,
    auth: enAuth,
  },
  es: {
    common: esCommon,
    nav: esNav,
    inbox: esInbox,
    board: esBoard,
    issue: esIssue,
    cycles: esCycles,
    roadmap: esRoadmap,
    schedule: esSchedule,
    settings: esSettings,
    palette: esPalette,
    dependencies: esDependencies,
    auth: esAuth,
  },
};

function syncHtmlLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng.split("-")[0] ?? lng;
  }
}

const supportedCodes = SUPPORTED_LOCALES.map((l) => l.code);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: supportedCodes,
    defaultNS: "common",
    ns: [...I18N_NAMESPACES],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
    react: { useSuspense: false },
  });

syncHtmlLang(i18n.language || DEFAULT_LOCALE);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
