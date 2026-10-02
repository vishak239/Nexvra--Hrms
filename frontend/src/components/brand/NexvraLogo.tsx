/* eslint-disable @next/next/no-img-element */
/**
 * The ONLY place the Nexvra logo is rendered. It displays the official asset unmodified
 * (brand/nexvra-logo.svg, copied by scripts/sync-brand.mjs). Never redraw, recolour,
 * crop or restyle it.
 *
 * The official file has a black background built in, so place it on dark surfaces
 * (e.g. the sidebar or header), not on white.
 */
const LOGO_SRC = "/brand/nexvra-logo.svg";
const INTRINSIC = { width: 1536, height: 1024 }; // keeps the supplied aspect ratio

export function NexvraLogo({ height = 32, className }: { height?: number; className?: string }) {
  const width = Math.round((INTRINSIC.width / INTRINSIC.height) * height);
  return <img src={LOGO_SRC} alt="Nexvra Solutions" width={width} height={height} className={className} />;
}
