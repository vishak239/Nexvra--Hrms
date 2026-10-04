// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { THEME_BOOT_SCRIPT, THEME_KEY } from "@/lib/theme-script";
import { ThemeToggle } from "./ThemeToggle";

function prefersDark(value: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: value, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
});
afterEach(cleanup);

describe("theme", () => {
  it("follows the device when nothing is chosen, and remembers an explicit choice", () => {
    prefersDark(true);
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(screen.getByTestId("theme-toggle"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");

    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(screen.getByRole("menuitemradio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies the saved theme before React renders (no flash)", () => {
    prefersDark(true);
    window.localStorage.setItem(THEME_KEY, "light");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    window.localStorage.setItem(THEME_KEY, "system");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
