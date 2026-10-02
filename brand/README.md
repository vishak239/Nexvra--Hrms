# Brand assets

| File | Status |
|---|---|
| `nexvra-logo.svg` | **Official logo** (confirmed by the owner, 2026-10-01). It's an Inkscape SVG wrapping a 1536×1024 high-resolution image of the mark on a built-in black background. Renamed from `nexvra logo.svg` only; the content is byte-identical. |
| `nexvra-logo.png` | Original small raster (76×78) from project start. No longer used by the app; kept for reference. |

Brand colours: Nexvra Lime `#9CFF00`, Black `#000000`, White `#FFFFFF`, Gray `#A0A0A0`.

Rules: use the files exactly as supplied. Never redraw, recolour, simplify, re-proportion, or replace them with CSS or icon-library versions.
The frontend copies this folder into `frontend/public/brand/` and renders the logo only through its `NexvraLogo` component.

Notes:
- Because of the built-in black background, place the logo on dark surfaces only.
- The file is about 977 KB. Browsers cache it after the first load. A true vector version (transparent background) from a designer would be lighter and sharper; if one is supplied, drop it in under the same name.
- `design/stitch/stitch-logo-redraw.reference.svg` is a redraw Stitch generated. It is **not** official and must not be used as the logo.
