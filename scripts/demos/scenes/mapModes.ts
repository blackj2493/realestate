/**
 * Scene: terminal-map-modes — "Listings · Heatmap · 3D".
 *
 * Anon-safe: flip the map through its three render modes from the bottom dock,
 * holding on each long enough for the mode to read.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "terminal-map-modes",
  title: "Listings · Heatmap · 3D",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator('[data-tour="terminal-map-modes"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(700, 500);
    await human.pause(400);

    const dock = '[data-tour="terminal-map-modes"]';
    await human.click(`${dock} button:has-text("Heatmap")`);
    await human.pause(3200);
    await human.click(`${dock} button:has-text("3D")`);
    await human.pause(3800);
    await human.click(`${dock} button:has-text("Listings")`);
    await human.pause(2200);
  },
};

export default scene;
