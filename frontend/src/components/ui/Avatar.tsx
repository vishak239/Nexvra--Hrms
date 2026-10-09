"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/format";

/**
 * The private, permission-checked profile photo of an employee. `version` (photo_version from the
 * API) changes with every new upload, so browsers may cache the image and still show a new photo
 * at once. Null when there is no photo: the initials avatar is shown instead.
 */
export function photoUrl(employeeId: number | null | undefined, version?: string | null, hasPhoto = true) {
  if (!employeeId || !hasPhoto) return null;
  return `/api/employees/${employeeId}/photo/${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/**
 * Round avatar: the photo when there is one, otherwise (or while it loads, or if it cannot be
 * loaded) a clean initials badge, so a broken image or an empty green circle never appears.
 */
export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  useEffect(() => setState("loading"), [src]);
  const style = { width: size, height: size };
  const showPhoto = !!src && state !== "failed";
  return (
    <span style={style} className="relative inline-flex shrink-0" data-testid="avatar" data-state={src ? state : "none"}>
      {(!showPhoto || state === "loading") && (
        <span
          style={{ ...style, fontSize: Math.max(11, size * 0.36) }}
          className="absolute inset-0 inline-flex items-center justify-center rounded-[50%] bg-surface-container-high font-semibold text-on-surface-variant"
          aria-hidden="true"
        >
          {initials(name) || "?"}
        </span>
      )}
      {showPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          style={style}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={`relative rounded-[50%] bg-surface-container object-cover transition-opacity ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
