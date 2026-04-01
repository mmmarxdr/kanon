import { useCallback } from "react";
import { messages, type MessageKey } from "@/i18n/messages";
import { useLocaleStore } from "@/stores/locale-store";

export function useI18n() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const t = useCallback(
    (key: MessageKey): string => {
      const pack = messages[locale];
      const value = pack[key];
      if (value !== undefined && value !== "") {
        return value;
      }
      return messages.en[key] ?? key;
    },
    [locale],
  );

  return { t, locale, setLocale };
}
