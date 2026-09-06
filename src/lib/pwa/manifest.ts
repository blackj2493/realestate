import type { MetadataRoute } from "next";

/**
 * The installable-app manifest, as pure data.
 *
 * `src/app/manifest.ts` serves this at /manifest.webmanifest and Next links it from
 * every page. It lives here, outside the app router, so the shape is unit-testable and
 * so the root layout reads THEME_COLOR from the same place — Chrome warns when the
 * manifest's theme_color and the page's <meta name="theme-color"> disagree.
 */

/**
 * The light Daylight ground (#e9edf4 = --background on :root). Light is the app default
 * for everyone and dark is a stored opt-in, so the chrome colour is fixed rather than
 * tracking prefers-color-scheme — see the viewport comment in src/app/layout.tsx.
 */
export const THEME_COLOR = "#e9edf4";

/**
 * Splash ground behind the icon while the app boots. Same as THEME_COLOR so the splash
 * dissolves into the dashboard instead of flashing a different band first.
 */
export const BACKGROUND_COLOR = "#e9edf4";

/**
 * An installed app is a returning-user surface, so it opens on Mission Control rather
 * than the marketing hero. A signed-out user is bounced through /login → /welcome →
 * /dashboard by requireConsumer — the native-app pattern (open, then sign in).
 */
export const START_URL = "/dashboard";

export function buildManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PureProperty",
    short_name: "PureProperty",
    description:
      "Every active Ontario MLS® listing, decoded — cap rate, schools, walkability and development potential in one place.",
    start_url: START_URL,
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    lang: "en",
    categories: ["finance", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed variant for launchers that mask icons into a circle or squircle.
      // Kept separate from the `any` icons on purpose: one icon declared "any maskable"
      // gets its corners clipped on launchers that don't mask.
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-press shortcuts on the home-screen icon. Same three sections as NAV_ITEMS.
    shortcuts: [
      { name: "Dashboard", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Map", url: "/properties", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Market Trends", url: "/analytics", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
