/**
 * Scene: rail-commute — "Commute Isochrone".
 *
 * Anon-safe: open the Commute drawer, type a destination, pick the suggestion,
 * and watch the reachable-area zone shade onto the map and filter the ledger.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "rail-commute",
  title: "Commute Isochrone",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator('[data-tour="rail-commute"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(560, 420);
    await human.pause(350);
    await human.click('[data-tour="rail-commute"]');
    await human.pause(900);

    // Destination — Union Station by street address: the geocoder matches
    // addresses/streets (no POI names), so "65 Front St W" is the reliable query.
    const input = 'input[placeholder*="Address, station"]';
    await human.click(input);
    await human.type("65 Front St W, Toronto");
    // Debounced geocode → pick the first suggestion.
    const suggestion = page.locator('button:has-text("65 Front Street West")').first();
    await suggestion.waitFor({ state: "visible", timeout: 15_000 });
    await human.pause(500);
    const box = await suggestion.boundingBox();
    if (!box) throw new Error("no geocode suggestion");
    await human.clickXY(box.x + Math.min(box.width / 2, 180), box.y + box.height / 2);

    // Isochrone fetch + shade + ledger re-filter.
    await human.pause(3600);

    // Park the cursor over the zone so the eye lands on the map result.
    const canvas = await page.locator(".mapboxgl-canvas").first().boundingBox();
    if (canvas) await human.moveTo(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.55);
    await human.pause(2600);
  },
};

export default scene;
