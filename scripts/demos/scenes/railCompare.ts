/**
 * Scene: rail-compare — "Compare Properties".
 *
 * Anon-safe: open the Compare drawer, check three listings into the basket via
 * the ledger checkboxes, then open the side-by-side comparison page.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "rail-compare",
  title: "Compare Properties",
  path: "/properties",
  async run({ page, human, markStart }) {
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.locator('[data-tour="rail-compare"]').waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(4000);
    markStart();

    await human.moveTo(560, 420);
    await human.pause(350);
    await human.click('[data-tour="rail-compare"]');
    await human.pause(900);

    // Check the first three ledger rows into the basket. The checkbox may only
    // paint on row hover, so glide over the row first, then click it.
    const checkbox = 'button[aria-label="Add to selection"]';
    for (let i = 0; i < 3; i++) {
      const cb = page.locator(checkbox).nth(i);
      await cb.waitFor({ state: "attached", timeout: 15_000 });
      await cb.scrollIntoViewIfNeeded();
      const box = await cb.boundingBox();
      if (!box) throw new Error(`checkbox ${i} has no box`);
      await human.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await human.pause(320);
      await human.clickXY(box.x + box.width / 2, box.y + box.height / 2);
      await human.pause(650);
    }

    // Basket shows 3 — open the side-by-side page.
    await human.pause(600);
    await human.click('a:has-text("Compare")');
    await page.waitForURL(/\/properties\/compare/, { timeout: 30_000 });
    await page.waitForTimeout(2500); // table + thumbnails settle
    await human.moveTo(800, 450);
    await human.scroll(500);
    await human.pause(2600);
  },
};

export default scene;
