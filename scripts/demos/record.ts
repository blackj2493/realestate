/**
 * Demo-clip recorder CLI.
 *
 *   npm run demo:record -- --list
 *   npm run demo:record -- rail-draw
 *   npm run demo:record -- --all --base-url=http://localhost:3000
 *   npm run demo:record -- rail-draw --headed --keep-webm
 *
 * Defaults to recording against prod (www.pureproperty.ca) as an ANONYMOUS
 * visitor — by definition VOW-safe. Unlocked-experience scenes must instead be
 * pointed at a local dev server running with DEMO_FIXTURES=1 (see
 * scripts/demos/make-fixture.ts).
 */

import { SCENES, findScene } from "./scenes";
import { recordScene } from "./lib/runner";
import type { Scene } from "./lib/types";

const DEFAULT_BASE_URL = process.env.DEMO_BASE_URL || "https://www.pureproperty.ca";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const kv = new Map(
    argv
      .filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => {
        const i = a.indexOf("=");
        return [a.slice(0, i), a.slice(i + 1)] as const;
      })
  );
  const ids = argv.filter((a) => !a.startsWith("--"));

  if (flags.has("--list")) {
    for (const s of SCENES) console.log(`${s.id.padEnd(24)} ${s.title}`);
    return;
  }

  const baseUrl = kv.get("--base-url") || DEFAULT_BASE_URL;
  const scenes: Scene[] = flags.has("--all")
    ? SCENES
    : ids.map((id) => {
        const s = findScene(id);
        if (!s) {
          console.error(`Unknown scene "${id}". Known: ${SCENES.map((x) => x.id).join(", ")}`);
          process.exit(1);
        }
        return s;
      });

  if (scenes.length === 0) {
    console.error("Nothing to record. Pass scene ids, --all, or --list.");
    process.exit(1);
  }

  console.log(`Recording ${scenes.length} scene(s) against ${baseUrl}\n`);
  const failures: string[] = [];
  for (const scene of scenes) {
    process.stdout.write(`▶ ${scene.id} — ${scene.title} ... `);
    try {
      const r = await recordScene(scene, {
        baseUrl,
        headed: flags.has("--headed"),
        keepWebm: flags.has("--keep-webm"),
        keepCoachDots: flags.has("--keep-coach-dots"),
      });
      console.log(`ok (${r.seconds.toFixed(1)}s)\n  ${r.mp4}\n  ${r.poster}`);
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      failures.push(scene.id);
    }
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} scene(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main();
