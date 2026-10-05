import { linkify } from "@/lib/linkify";

/**
 * Plain text with its web links clickable. Rendered as React text and <a> elements only (never
 * as HTML), so a message containing markup or script is displayed, not executed. Links open in
 * a new tab without giving the page access to Nexvra (noopener, noreferrer).
 */
export function LinkifiedText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {linkify(text).map((part, i) =>
        part.kind === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all font-medium text-primary-fixed underline underline-offset-2 hover:opacity-80"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
