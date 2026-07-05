/**
 * Scene: rail-color — "Color the Map by Any Metric".
 *
 * Anon-safe: open the Color By drawer and flip the map's paint metric between
 * Cap Rate and True DOM — the pins/columns and HUD legend restyle live.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "rail-color",
  title: "Color the Map by Any Metric",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator('[data-tour="rail-color"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(560, 420);
    await human.pause(350);
    await human.click('[data-tour="rail-color"]');
    await human.pause(900);

    await human.click('button:has-text("Cap Rate")');
    await human.pause(3200);
    await human.click('button:has-text("True DOM")');
    await human.pause(3200);
    await human.click('button:has-text("Price Drop")');
    await human.pause(3000);
  },
};

export default scene;
