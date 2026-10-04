"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "@/components/ui/icons";
import { useTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Match my device", Icon: Monitor },
];

/** Header theme switcher (light / dark / system), remembered in this browser. */
export function ThemeToggle() {
  const { preference, dark, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const CurrentIcon = dark ? Moon : Sun;

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${OPTIONS.find((o) => o.value === preference)?.label}`}
        data-testid="theme-toggle"
      >
        <CurrentIcon className="h-6 w-6" />
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className="absolute right-0 z-40 mt-2 w-52 rounded-xl border border-surface-container-high bg-surface-container p-1.5">
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              onClick={() => {
                setPreference(value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-body-md text-on-surface hover:bg-surface-container-high"
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {preference === value && <Check className="h-4 w-4 text-primary-fixed" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
