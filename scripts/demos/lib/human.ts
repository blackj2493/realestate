/**
 * Human — makes the Playwright mouse move like a person, not a teleporter.
 *
 * Glides are eased (easeInOutCubic) with a slight perpendicular bow so long
 * moves don't look laser-straight; clicks settle briefly before pressing;
 * typing is paced with deterministic (sin-based) jitter so re-recordings of an
 * unchanged scene produce identical timing.
 */

import type { Page } from "playwright";

export class Human {
  private x = 0;
  private y = 0;

  constructor(private page: Page) {}

  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Eased, interpolated glide to (x, y). Duration scales with distance. */
  async moveTo(x: number, y: number, opts: { duration?: number } = {}): Promise<void> {
    const x0 = this.x;
    const y0 = this.y;
    const dist = Math.hypot(x - x0, y - y0);
    if (dist < 1) return;
    const duration = opts.duration ?? Math.min(950, 220 + dist * 0.85);
    const steps = Math.max(8, Math.round(duration / 16));
    // Perpendicular unit vector for a subtle arc.
    const px = -(y - y0) / dist;
    const py = (x - x0) / dist;
    const bow = Math.min(36, dist * 0.07);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const arc = Math.sin(Math.PI * e) * bow;
      await this.page.mouse.move(x0 + (x - x0) * e + px * arc, y0 + (y - y0) * e + py * arc);
      await this.page.waitForTimeout(duration / steps);
    }
    await this.page.mouse.move(x, y);
    this.x = x;
    this.y = y;
  }

  /** Glide to a point, settle, then press. */
  async clickXY(x: number, y: number, opts: { settle?: number } = {}): Promise<void> {
    await this.moveTo(x, y);
    await this.pause(opts.settle ?? 160);
    await this.page.mouse.down();
    await this.pause(90);
    await this.page.mouse.up();
  }

  /** Glide to a selector's center (plus optional offset) and click it. */
  async click(
    selector: string,
    opts: { settle?: number; dx?: number; dy?: number; timeout?: number; nth?: number } = {}
  ): Promise<void> {
    const loc = this.page.locator(selector).nth(opts.nth ?? 0);
    await loc.waitFor({ state: "visible", timeout: opts.timeout ?? 20_000 });
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`No bounding box for selector: ${selector}`);
    await this.clickXY(box.x + box.width / 2 + (opts.dx ?? 0), box.y + box.height / 2 + (opts.dy ?? 0), opts);
  }

  /** Paced typing into whatever currently has focus. */
  async type(text: string, opts: { cps?: number } = {}): Promise<void> {
    const base = 1000 / (opts.cps ?? 13);
    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i]);
      // Deterministic jitter: same scene → same rhythm on every re-record.
      const jitter = 0.6 + 0.8 * Math.abs(Math.sin(i * 2.7));
      await this.page.waitForTimeout(base * jitter);
    }
  }

  /** Smooth wheel scroll in steps (positive dy scrolls down). */
  async scroll(dy: number, opts: { stepPx?: number } = {}): Promise<void> {
    const step = opts.stepPx ?? 120;
    const n = Math.max(1, Math.round(Math.abs(dy) / step));
    for (let i = 0; i < n; i++) {
      await this.page.mouse.wheel(0, Math.sign(dy) * step);
      await this.page.waitForTimeout(28);
    }
  }

  /** Wheel-scroll until the element sits ~offsetY px from the viewport top. */
  async scrollTo(selector: string, opts: { offsetY?: number; timeout?: number } = {}): Promise<void> {
    const offsetY = opts.offsetY ?? 200;
    const loc = this.page.locator(selector).first();
    await loc.waitFor({ state: "attached", timeout: opts.timeout ?? 20_000 });
    for (let i = 0; i < 24; i++) {
      const box = await loc.boundingBox();
      if (!box) break;
      const delta = box.y - offsetY;
      if (Math.abs(delta) < 48) break;
      await this.scroll(Math.sign(delta) * Math.min(Math.abs(delta), 640));
      await this.pause(110);
    }
  }
}
