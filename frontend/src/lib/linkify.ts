/**
 * Finds web links in plain message text, safely.
 *
 * The text is never parsed as HTML: it is split into plain-text and link parts, and React renders
 * each part as text or as an <a> element, so markup or script in a message is shown as text.
 * Only http(s) links become clickable (javascript:, data:, file: ... never do); "www." links are
 * opened as https. Trailing punctuation that usually ends a sentence is left outside the link.
 */

export type TextPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

// http(s)://… or www.… up to whitespace or characters that cannot start/continue a bare URL.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;
const MAX_URL = 2048;

function balanced(url: string) {
  // Keep a closing parenthesis that belongs to the URL, e.g. https://en.wikipedia.org/wiki/X_(Y)
  let trimmed = url;
  while (TRAILING.test(trimmed)) {
    const last = trimmed[trimmed.length - 1];
    if (last === ")" && (trimmed.match(/\(/g)?.length ?? 0) >= (trimmed.match(/\)/g)?.length ?? 0)) break;
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/** A safe absolute http(s) URL for the link, or null when it is not one. */
export function safeHref(raw: string): string | null {
  if (raw.length > MAX_URL) return null;
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null; // no credentials in links
    return url.href;
  } catch {
    return null;
  }
}

export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = balanced(match[0]);
    const href = raw.length > 4 ? safeHref(raw) : null;
    if (!href) continue;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    parts.push({ kind: "link", text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts.length ? parts : [{ kind: "text", text }];
}
