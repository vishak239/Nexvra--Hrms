// Plain (non-client) module so the root server layout can inline the script in <head>.
export type ThemePreference = "light" | "dark" | "system";
export const THEME_KEY = "nexvra.theme";

/**
 * Runs before the page paints, so there is no flash of the wrong theme. Mirrors `applyTheme`
 * in lib/theme.tsx; keep them in sync.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=p;}catch(e){document.documentElement.classList.add("dark");}})();`;
