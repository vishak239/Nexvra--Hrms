"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { THEME_KEY, type ThemePreference } from "./theme-script";

export type { ThemePreference };

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = preference;
  return dark;
}

interface ThemeValue {
  preference: ThemePreference;
  dark: boolean;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue>({ preference: "system", dark: true, setPreference: () => undefined });

/** Light / dark / follow-the-system theme, remembered per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>("system");
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const initial = readPreference();
    setPref(initial);
    setDark(applyTheme(initial));
  }, []);

  // Follow OS changes while the preference is "system".
  useEffect(() => {
    if (preference !== "system" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(applyTheme("system"));
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_KEY, p);
    } catch {
      // Storage blocked: the choice applies to this page view only.
    }
    setPref(p);
    setDark(applyTheme(p));
  }, []);

  return <ThemeContext.Provider value={{ preference, dark, setPreference }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
