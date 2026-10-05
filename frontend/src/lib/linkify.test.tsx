// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { linkify, safeHref } from "./linkify";

describe("message links", () => {
  it("finds https, http and www links and leaves the rest as text", () => {
    expect(linkify("Please check https://example.com")).toEqual([
      { kind: "text", text: "Please check " },
      { kind: "link", text: "https://example.com", href: "https://example.com/" },
    ]);
    const parts = linkify("See http://intranet.local/a?b=1 and www.nexvra.com/docs.");
    expect(parts.filter((p) => p.kind === "link").map((p) => (p.kind === "link" ? p.href : ""))).toEqual([
      "http://intranet.local/a?b=1",
      "https://www.nexvra.com/docs",
    ]);
    expect(parts[parts.length - 1]).toEqual({ kind: "text", text: "." }); // sentence punctuation stays outside
  });

  it("keeps a closing parenthesis that belongs to the link", () => {
    const [, link, rest] = linkify("(see https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(link).toEqual({
      kind: "link",
      text: "https://en.wikipedia.org/wiki/Foo_(bar)",
      href: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
    expect(rest).toEqual({ kind: "text", text: ")" });
  });

  it("never links other schemes or credentials", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https://user:pw@example.com"]) {
      expect(safeHref(bad)).toBeNull();
    }
    expect(linkify("javascript:alert(1)")).toEqual([{ kind: "text", text: "javascript:alert(1)" }]);
    expect(linkify("plain text, no links")).toEqual([{ kind: "text", text: "plain text, no links" }]);
  });

  it("renders markup and scripts as text, and links safely", () => {
    const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script> https://example.com/"><b>x</b>`;
    const { container } = render(<LinkifiedText text={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(2)</script>");
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com/");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(links[0].getAttribute("rel")).toContain("noreferrer");
  });
});
