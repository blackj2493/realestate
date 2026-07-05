/**
 * recordScene — launch Chromium, drive one Scene with the Human cursor, and
 * write out/<id>.mp4 (H.264, loop-friendly, silent) + out/<id>.jpg poster.
 *
 * Playwright records webm/VP8 natively; ffmpeg (ffmpeg-static) re-encodes to
 * mp4 for Safari/social compatibility and grabs the poster frame. Output goes
 * to scripts/demos/out/ (already gitignored via the root `out/` pattern).
 */

import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Human } from "./human";
import { CURSOR_INIT, discoverySeedInit, type SeedOptions } from "./inject";
import type { Scene } from "./types";

export const OUT_DIR = path.join(__dirname, "..", "out");

export interface RecordOptions extends SeedOptions {
  baseUrl: string;
  /** Watch the recording live (debugging scene scripts). */
  headed?: boolean;
  /** Keep the intermediate webm next to the mp4. */
  keepWebm?: boolean;
}

export interface RecordResult {
  mp4: string;
  poster: string;
  seconds: number;
}

export async function recordScene(scene: Scene, opts: RecordOptions): Promise<RecordResult> {
  const viewport = scene.viewport ?? { width: 1600, height: 900 };
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: scene.colorScheme ?? "dark",
    baseURL: opts.baseUrl,
    recordVideo: { dir: OUT_DIR, size: viewport },
  });
  await context.addInitScript(discoverySeedInit(opts));
  await context.addInitScript(CURSOR_INIT);

  const page = await context.newPage();
  const human = new Human(page);
  const started = Date.now();
  let markMs = 0; // scene-declared "action starts here" offset into the recording
  try {
    await page.goto(scene.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await scene.run({
      page,
      context,
      human,
      baseUrl: opts.baseUrl,
      markStart: () => {
        if (markMs === 0) markMs = Date.now() - started;
      },
    });
    await page.waitForTimeout(700); // trailing hold so the clip doesn't cut on the last click
  } finally {
    const video = page.video();
    await context.close(); // flushes the recording
    await browser.close();
    if (video) {
      const raw = await video.path();
      const webm = path.join(OUT_DIR, `${scene.id}.webm`);
      if (existsSync(webm)) rmSync(webm);
      renameSync(raw, webm);
    }
  }
  const seconds = (Date.now() - started) / 1000;

  // Trim the recorded load time: cut to ~1s before the scene's markStart().
  const trimSec = markMs > 0 ? Math.max(0, markMs / 1000 - 1) : 0;
  const webm = path.join(OUT_DIR, `${scene.id}.webm`);
  const { mp4, poster } = postProcess(scene.id, webm, trimSec, opts.keepWebm === true);
  return { mp4, poster, seconds };
}

function postProcess(
  id: string,
  webm: string,
  trimSec: number,
  keepWebm: boolean
): { mp4: string; poster: string } {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve a binary for this platform");
  const mp4 = path.join(OUT_DIR, `${id}.mp4`);
  const poster = path.join(OUT_DIR, `${id}.jpg`);
  const trim = trimSec > 0 ? ["-ss", trimSec.toFixed(2)] : [];
  execFileSync(
    ffmpegPath,
    ["-y", ...trim, "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  execFileSync(ffmpegPath, ["-y", "-ss", "1", "-i", mp4, "-frames:v", "1", "-update", "1", "-q:v", "3", poster], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (!keepWebm) rmSync(webm);
  return { mp4, poster };
}
