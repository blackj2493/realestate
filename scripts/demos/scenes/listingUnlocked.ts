/**
 * Scene: listing-unlocked — the signed-in listing intelligence stack.
 *
 * COMPLIANCE: this scene requires the SYNTHETIC demo listing (PPDEMO001) served
 * by a local dev server with DEMO_FIXTURES=1 — every number on screen is
 * fabricated (see scripts/demos/make-fixture.ts). Never point this scene at a
 * real listing: it renders the ungated experience.
 *
 * Flow: hero → Deal Score → "The Read" → Force-Appreciation upside →
 * Underwriting Sandbox — the differentiator stack, top to bottom.
 */

import type { Scene } from "../lib/types";

const scene: Scene = {
  id: "listing-unlocked",
  title: "Listing intelligence (unlocked)",
  path: "/properties/PPDEMO001",
  async run({ page, human, markStart, baseUrl }) {
    if (!/localhost|127\.0\.0\.1/.test(baseUrl)) {
      throw new Error(
        "listing-unlocked must run against a local dev server with DEMO_FIXTURES=1 — refusing to record the ungated page anywhere else."
      );
    }
    await page.locator('[data-tour="listing-deal-score"]').waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(3000); // gallery images settle
    markStart();

    // Open on the hero for a beat.
    await human.moveTo(760, 430);
    await human.pause(1400);

    // Deal Score — hover the card so the cursor anchors the eye.
    await human.scrollTo('[data-tour="listing-deal-score"]');
    const ds = await page.locator('[data-tour="listing-deal-score"]').first().boundingBox();
    if (ds) await human.moveTo(ds.x + ds.width * 0.5, ds.y + Math.min(ds.height * 0.45, 220));
    await human.pause(2200);

    // The Read — the plain-language verdict.
    await human.scrollTo('[data-tour="listing-the-read"]');
    const tr = await page.locator('[data-tour="listing-the-read"]').first().boundingBox();
    if (tr) await human.moveTo(tr.x + tr.width * 0.5, tr.y + Math.min(tr.height * 0.4, 200));
    await human.pause(2400);

    // Force-Appreciation — the renovation-ROI headline feature.
    await human.scrollTo('[data-tour="listing-force-appreciation"]');
    const fa = await page.locator('[data-tour="listing-force-appreciation"]').first().boundingBox();
    if (fa) await human.moveTo(fa.x + fa.width * 0.5, fa.y + Math.min(fa.height * 0.4, 200));
    await human.pause(2400);

    // Underwriting Sandbox — end on the live what-if calculator.
    await human.scrollTo('[data-tour="listing-underwriting"]');
    const uw = await page.locator('[data-tour="listing-underwriting"]').first().boundingBox();
    if (uw) await human.moveTo(uw.x + uw.width * 0.5, uw.y + Math.min(uw.height * 0.4, 220));
    await human.pause(2600);
  },
};

export default scene;
