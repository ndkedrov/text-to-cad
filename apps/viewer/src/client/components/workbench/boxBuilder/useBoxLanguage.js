import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getBoxLanguage,
  setBoxLanguage,
  subscribeBoxLanguage,
  translate
} from "@/workbench/boxBuilder/i18n.js";

// The box builder's language and its translator; every caller re-renders on a switch.
export function useBoxLanguage() {
  const language = useSyncExternalStore(subscribeBoxLanguage, getBoxLanguage, () => "en");
  const t = useCallback((key, params) => translate(language, key, params), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return { language, setLanguage: setBoxLanguage, t };
}
