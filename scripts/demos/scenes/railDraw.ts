/**
 * Scene: rail-draw — "Draw a Custom Area".
 *
 * Anon-safe (IDX map view only): open the terminal, click the Draw tile on the
 * map rail, lasso a five-point polygon over the map, hit Finish, and let the
 * ledger re-filter to the shape.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "rail-draw",
  title: "Draw a Custom Area",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator('[data-tour="rail-draw"]').waitFor({ state: "visible", timeout: 30_000 });
    // Let tiles + the first listings batch settle so the clip opens on a live map.
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(560, 420);
    await human.pause(350);
    await human.click('[data-tour="rail-draw"]');
    await human.pause(900); // drawer opens, draw mode arms

    const canvas = await page.locator(".mapboxgl-canvas").first().boundingBox();
    if (!canvas) throw new Error("map canvas has no bounding box");
    // Bias the lasso right of the rail + drawer so the shape stays fully visible.
    const cx = canvas.x + canvas.width * 0.58;
    const cy = canvas.y + canvas.height * 0.48;
    const rx = canvas.width * 0.16;
    const ry = canvas.height * 0.27;
    const angles = [-95, -25, 40, 115, 195];
    for (const deg of angles) {
      const a = (deg * Math.PI) / 180;
      await human.clickXY(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      await human.pause(330);
    }

    await human.pause(400);
    await human.click('button:has-text("Finish")');
    await human.pause(2800); // polygon commits, map + ledger re-filter
  },
};

export default scene;
