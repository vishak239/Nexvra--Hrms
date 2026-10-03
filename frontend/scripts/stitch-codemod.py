"""One-off codemod: maps the old light-theme Tailwind classes to the Stitch design tokens.

Kept in the repo so the mapping is documented. Usage: python scripts/stitch-codemod.py [--check]
--check only reports files that still contain unmapped legacy classes (exit 1 if any).
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")

# legacy utility -> Stitch utility (variant prefixes such as hover: and opacity suffixes are kept)
MAP = {
    "bg-white": "bg-surface-container-low",
    "bg-zinc-50": "bg-surface-container",
    "bg-zinc-100": "bg-surface-container-high",
    "bg-zinc-200": "bg-surface-container-highest",
    "bg-zinc-900": "bg-surface-container-highest",
    "text-zinc-900": "text-primary",
    "text-zinc-800": "text-on-surface",
    "text-zinc-700": "text-on-surface",
    "text-zinc-600": "text-on-surface-variant",
    "text-zinc-500": "text-on-surface-variant",
    "text-zinc-400": "text-outline",
    "text-zinc-300": "text-on-surface-variant/40",
    "border-zinc-100": "border-surface-container-high/40",
    "border-zinc-200": "border-surface-container-high/60",
    "border-zinc-300": "border-surface-container-high",
    "border-zinc-900": "border-primary-container",
    "divide-zinc-100": "divide-surface-container-high/40",
    "divide-zinc-200": "divide-surface-container-high",
    "ring-zinc-900": "ring-primary-container",
    "ring-zinc-200": "ring-surface-container-high",
    "text-red-600": "text-error",
    "text-red-700": "text-error",
    "text-red-800": "text-on-error-container",
    "bg-red-50": "bg-error-container/25",
    "bg-red-600": "bg-error-container",
    "bg-red-700": "bg-error-container",
    "border-red-200": "border-error-container",
    "border-red-400": "border-error",
    "ring-red-200": "ring-error-container",
    "bg-green-50": "bg-primary-container/10",
    "text-green-700": "text-primary-fixed",
    "text-green-800": "text-primary-fixed",
    "border-green-200": "border-primary-container/30",
    "ring-green-200": "ring-primary-container/30",
    "bg-amber-50": "bg-warning-container",
    "text-amber-700": "text-warning",
    "text-amber-800": "text-warning",
    "text-amber-900": "text-warning",
    "border-amber-200": "border-warning-outline",
    "ring-amber-200": "ring-warning-outline",
    "ring-amber-300": "ring-warning-outline",
    "bg-sky-50": "bg-surface-container-high",
    "text-sky-700": "text-on-surface",
    "ring-sky-200": "ring-surface-container-highest",
    "bg-nexvra-lime": "bg-primary-container",
    "text-nexvra-lime": "text-primary-fixed",
    "text-nexvra-gray": "text-on-surface-variant",
    "text-black": "text-on-primary-fixed",
    "text-white": "text-primary",
    "rounded-2xl": "rounded-xl",
}
# DESIGN.md: depth comes from tonal layers and 1px lines, never drop shadows.
REMOVE = {"shadow-card", "shadow-sm", "shadow", "shadow-md", "shadow-lg", "shadow-xl"}

TOKEN = re.compile(r"(?<![\w\-\[/:])((?:[a-z0-9\-\[\]&>:]+:)*)([a-z]+-[a-z0-9\-]+|shadow)(/\d+)?(?![\w\-])")


def convert(text):
    def sub(m):
        prefix, base, opacity = m.group(1), m.group(2), m.group(3) or ""
        if base in REMOVE and not opacity:
            return ""
        if base in MAP:
            new = MAP[base]
            if opacity and "/" in new:  # e.g. border-zinc-200/50 -> keep the explicit opacity
                new = new.split("/")[0]
            return f"{prefix}{new}{opacity}"
        return m.group(0)

    def in_class(m):
        inner = TOKEN.sub(sub, m.group(0))
        return re.sub(r"(?<=\S) {2,}(?=\S)", " ", inner)  # close gaps left by removed shadows

    # only touch string literals / template literals (where class names live)
    return re.sub(r'"[^"\n]*"|`[^`]*`', in_class, text)


def files():
    for f in glob.glob(os.path.join(ROOT, "**", "*.tsx"), recursive=True):
        if f.endswith(".test.tsx") or f.endswith(os.path.join("ui", "icons.tsx")):
            continue
        yield f


LEGACY = re.compile(r"\b(?:bg|text|border|ring|divide)-(?:zinc|gray|slate|red|green|amber|sky|nexvra)-|\bbg-white\b|\btext-(?:white|black)\b|\bshadow-(?:card|sm|lg|md|xl)\b")

if __name__ == "__main__":
    check = "--check" in sys.argv
    dirty = []
    for f in files():
        s = open(f, encoding="utf-8").read()
        if check:
            if LEGACY.search(s):
                dirty.append(os.path.relpath(f, ROOT))
            continue
        out = convert(s)
        if out != s:
            open(f, "w", encoding="utf-8").write(out)
            dirty.append(os.path.relpath(f, ROOT))
    print(("legacy classes remain in:" if check else "updated:"), len(dirty))
    for d in dirty:
        print("  ", d)
    sys.exit(1 if check and dirty else 0)
