/**
 * Scene: terminal-map-modes — "Listings · Heatmap · 3D".
 *
 * Anon-safe: flip the map through its three render modes, holding on each long
 * enough for the mode to read.
 *
 * The switcher is now a collapsed layers button under the zoom cluster (it used
 * to be a labeled bottom-center dock), so every mode change is two clicks: open
 * the fan, pick the mode. Selectors key on aria-label because the fanned-out
 * options are icon-only — there is no text to match.
 */

import type { Scene } from "../lib/types";

const DOCK = '[data-tour="terminal-map-modes"]';
const TRIGGER = `${DOCK} button[aria-label^="Map mode:"]`;

const scene: Scene = {
  id: "terminal-map-modes",
  title: "Listings · Heatmap · 3D",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator(DOCK).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(700, 500);
    await human.pause(400);

    /** Open the fan, pick a mode, and hold on the result. */
    const pick = async (label: string, hold: number) => {
      await human.click(TRIGGER);
      await human.pause(500);
      await human.click(`${DOCK} button[aria-label="${label} mode"]`);
      await human.pause(hold);
    };

    await pick("Heatmap", 3200);
    await pick("3D", 3800);
    await pick("Listings", 2200);
  },
};

export default scene;
