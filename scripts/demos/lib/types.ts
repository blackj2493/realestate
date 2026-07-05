/**
 * Demo-clip recording harness — scene contract.
 *
 * A Scene is one feature demo: a scripted, human-looking drive of the REAL app
 * (real cursor → real button → real result; never abstract animations) that the
 * runner records to video. Scene ids match `featureRegistry.ts` ids so a future
 * `demoVideo` field on FeatureDef can resolve clips by convention
 * (`/demos/<feature-id>.mp4`).
 */

import type { BrowserContext, Page } from "playwright";
import type { Human } from "./human";

export interface SceneCtx {
  page: Page;
  context: BrowserContext;
  /** Human-motion driver: eased cursor glides, settled clicks, paced typing. */
  human: Human;
  baseUrl: string;
  /**
   * Call once the page has settled and the demo action is about to begin —
   * everything recorded before this point (loads, spinners) is trimmed from the
   * final mp4, minus a short pre-roll so the clip doesn't open mid-motion.
   */
  markStart(): void;
}

export interface Scene {
  /** Stable id — use the featureRegistry id where the clip demos a registry feature. */
  id: string;
  title: string;
  /** Route to open first (resolved against --base-url). */
  path: string;
  /** Defaults to 1600×900. */
  viewport?: { width: number; height: number };
  /** Defaults to "dark" (the terminal's native look). */
  colorScheme?: "dark" | "light";
  /**
   * COMPLIANCE (VOW §4): scenes recorded anonymously must only show what an anon
   * user sees on prod. Scenes that demo the unlocked experience must run against
   * a local dev server with DEMO_FIXTURES=1 and drive a PPDEMO* synthetic listing
   * — never a real listing while authenticated.
   */
  run(ctx: SceneCtx): Promise<void>;
}
