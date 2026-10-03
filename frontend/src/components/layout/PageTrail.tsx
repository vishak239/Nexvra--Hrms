"use client";

import { usePathname } from "next/navigation";
import { navTrail } from "@/lib/nav";

/** Stitch page eyebrow: "SECTION / PAGE", derived from the navigation config. */
export function PageTrail() {
  const trail = navTrail(usePathname() ?? "");
  if (!trail) return null;
  return (
    <div className="mb-1 flex items-center gap-space-sm" aria-hidden="true">
      <span className="rounded bg-surface-container-high px-2 py-0.5 font-code-mono text-code-mono font-semibold uppercase tracking-wider text-primary-fixed">
        {trail.section}
      </span>
      <span className="text-on-surface-variant/40">/</span>
      <span className="font-code-mono text-code-mono uppercase text-on-surface-variant">{trail.label}</span>
    </div>
  );
}
