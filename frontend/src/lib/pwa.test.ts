import { describe, expect, it } from "vitest";
import manifest from "../../public/manifest.json" assert { type: "json" };

describe("PWA manifest", () => {
  it("has the required fields for installability", () => {
    expect(manifest.name).toBe("Nexvra HRMS");
    expect(manifest.short_name).toBe("Nexvra HRMS");
    expect(manifest.start_url).toBe("/");
    expect(["standalone", "minimal-ui", "window-controls-overlay"]).toContain(manifest.display);
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons[0].src).toBe("/brand/nexvra-logo.png");
  });

  it("uses the same origin scope and language", () => {
    expect(manifest.scope).toBe("/");
    expect(manifest.lang).toBe("en");
  });
});
