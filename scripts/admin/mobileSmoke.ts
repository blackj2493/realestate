/**
 * Mobile smoke test — the checks that would have caught every mobile regression
 * of 2026-07-06 before merge:
 *   - header right-cluster overflow clipping the hamburger (theme merge)
 *   - overlays silently eating map pin taps (compliance strip, MapStatusHUD)
 *   - ghost-click self-navigating the pin popup (touch only — invisible to mouse)
 *   - theme toggle disappearing from the phone header
 *
 * Run against a dev server or prod before merging any UI-touching PR:
 *   npm run smoke:mobile                       # localhost:3000
 *   npm run smoke:mobile https://www.pureproperty.ca
 *
 * IMPORTANT: the map check uses TOUCH events (page.touchscreen.tap). Mouse
 * clicks have no synthesized ghost click and will pass while real phones fail.
 */

import { chromium, devices, type Page } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
let failures = 0;

function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}

async function headerChecks(page: Page, width: number) {
  const row = await page.evaluate(() => {
    const r = document.querySelector("header")?.firstElementChild as HTMLElement | null;
    return r ? { scroll: r.scrollWidth, client: r.clientWidth } : null;
  });
  check(
    `header row does not overflow @${width}px`,
    !!row && row.scroll <= row.client,
    row ? `scrollW ${row.scroll} / clientW ${row.client}` : "no <header> found"
  );
  const burger = await page
    .locator('button[aria-label="Open navigation menu"]')
    .first()
    .boundingBox()
    .catch(() => null);
  check(
    `hamburger fully on-screen @${width}px`,
    !!burger && burger.x >= 0 && burger.x + burger.width <= width,
    burger ? `x=${Math.round(burger.x)}..${Math.round(burger.x + burger.width)}` : "not rendered"
  );
  const toggle = await page
    .locator('header button[aria-label*="mode"]')
    .first()
    .boundingBox()
    .catch(() => null);
  check(
    `theme toggle in header, on-screen @${width}px`,
    !!toggle && toggle.x >= 0 && toggle.x + toggle.width <= width,
    toggle ? `x=${Math.round(toggle.x)}` : "not rendered"
  );
}

async function main() {
  const browser = await chromium.launch();

  // A real listing page exercises the full header cluster (incl. account button).
  const probe = await browser.newPage();
  await probe.goto(`${BASE}/sitemap.xml`, { timeout: 120000 });
  const listingPath = ((await probe.content()).match(/\/properties\/[A-Z][0-9]+/) ?? [null])[0];
  await probe.close();
  if (!listingPath) {
    console.log("❌ could not find a listing key in the sitemap — aborting");
    process.exit(1);
  }

  // ── Header budget at the two widths that matter (iPhone 390 / compact Android 360)
  for (const width of [390, 360]) {
    console.log(`\nHeader checks @${width}px — ${listingPath}`);
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: devices["iPhone 13"].userAgent,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${listingPath}`, { timeout: 300000 });
    await page.waitForTimeout(4000);
    await headerChecks(page, width);
    await ctx.close();
  }

  // ── Terminal map: TOUCH tap on a pin must open a popup that persists
  console.log(`\nTerminal map touch checks @390px — /properties`);
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/properties`, { timeout: 300000 });
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(15000);

  // Terminal's own header (TopCommandBar) — hamburger + theme toggle must be on-screen,
  // and the top bar must not overflow (the wordmark used to collide with the controls).
  const bar = await page.evaluate(() => {
    const r = document.querySelector(".dt-header") as HTMLElement | null;
    return r ? { scroll: r.scrollWidth, client: r.clientWidth } : null;
  });
  check("terminal top bar does not overflow @390px", !!bar && bar.scroll <= bar.client, bar ? `scrollW ${bar.scroll} / clientW ${bar.client}` : "no .dt-header");
  const tBurger = await page.locator('button[aria-label="Open navigation menu"]').first().boundingBox().catch(() => null);
  check("terminal hamburger on-screen @390px", !!tBurger && tBurger.x >= 0 && tBurger.x + tBurger.width <= 390, tBurger ? `x=${Math.round(tBurger.x)}` : "not rendered");
  const tToggle = await page.locator('button[aria-label*="mode"]').first().boundingBox().catch(() => null);
  check("terminal theme toggle on-screen @390px", !!tToggle && tToggle.x >= 0 && tToggle.x + tToggle.width <= 390, tToggle ? `x=${Math.round(tToggle.x)}` : "not rendered");

  // Ledger scope chip: it names the viewport ("Map area · Henry Farm +7"), and a label
  // clipped to "Map area · …" carries none of that. A phone has no hover, so the title
  // attribute can't recover it — a clipped chip is silent content loss. Measured on the
  // list tab, since the ledger is display:none behind the map view (0/0 would pass).
  await page.locator('button[aria-pressed]:has-text("list")').first().click().catch(() => {});
  await page.waitForTimeout(500);
  const chip = await page.evaluate(() => {
    const el = document.querySelector("[data-scope-chip-label]") as HTMLElement | null;
    if (!el || el.clientWidth === 0) return null;
    return { scroll: el.scrollWidth, client: el.clientWidth, text: el.textContent?.trim() ?? "" };
  });
  if (chip) {
    check(
      "ledger scope chip label is not clipped @390px",
      chip.scroll <= chip.client + 1,
      `"${chip.text}" scrollW ${chip.scroll} / clientW ${chip.client}`
    );
  } else {
    console.log("  ⏭️  ledger scope chip not rendered (place-scoped results) — skipped");
  }
  await page.locator('button[aria-pressed]:has-text("map")').first().click().catch(() => {});
  await page.waitForTimeout(500);

  const dialog = () => page.locator('div[role="dialog"][aria-label*="listing"]').count();
  const box = (await page.locator("canvas").first().boundingBox())!;
  const yFrom = Math.round(box.y + 35);
  const yTo = Math.round(Math.min(box.y + box.height - 60, box.y + 260));
  let opened = false;
  outer: for (let y = yFrom; y <= yTo; y += 10) {
    for (let x = 30; x <= 130; x += 10) {
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(300);
      if ((await dialog()) > 0) {
        opened = true;
        break outer;
      }
      if (!page.url().includes("/properties")) break outer; // ghost click navigated away
    }
  }
  check("touch tap on a pin opens the popup", opened, opened ? "" : `url now ${page.url().slice(0, 70)}`);
  if (opened) {
    await page.waitForTimeout(1000);
    check("popup persists 1s (ghost click shielded)", (await dialog()) > 0 && page.url().includes("/properties"));
  }
  await ctx.close();
  await browser.close();

  console.log(failures === 0 ? "\nAll mobile smoke checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke run failed:", String(e).slice(0, 300));
  process.exit(1);
});
