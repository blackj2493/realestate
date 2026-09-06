import { describe, it, expect } from "vitest";
import { buildManifest, THEME_COLOR, START_URL } from "./manifest";

describe("buildManifest", () => {
  const m = buildManifest();
  const icons = m.icons ?? [];

  it("declares the 192 and 512 icons Chrome requires to install, plus one maskable", () => {
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.filter((i) => i.purpose === "maskable")).toHaveLength(1);
  });

  it("never declares one icon as both any and maskable", () => {
    for (const i of icons) expect(i.purpose ?? "any").not.toMatch(/\s/);
  });

  it("keeps start_url inside scope and opens standalone", () => {
    expect(m.scope).toBe("/");
    expect(START_URL.startsWith(m.scope!)).toBe(true);
    expect(m.start_url).toBe(START_URL);
    expect(m.display).toBe("standalone");
  });

  it("matches the page's <meta name=theme-color> so Chrome doesn't warn", () => {
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(m.background_color).toBe(THEME_COLOR);
  });

  it("has a stable id so a URL change never forks the installed app", () => {
    expect(m.id).toBe("/");
  });
});
