/**
 * DashboardTeaser — what a SIGNED-OUT visitor sees at /dashboard (2026-11).
 *
 * WHY. /dashboard used to redirect a signed-out visitor straight to /login. PostHog
 * (Canada, 30 days to 2026-11-03): 16 of the 106 people who left /login without trying
 * had come from /dashboard, after a median 4.8 s — they clicked a menu item and met a wall.
 * The fully LOCKED Market Trends preview, by contrast, converts ~15% of signed-out viewers,
 * so this mirrors it: the real section names stay visible, every section's content is a grey
 * shape, and one VowGateOverlay asks for the sign-in. No number is fetched or rendered —
 * nothing personal exists before an account, and nothing VOW-derived reaches this page.
 *
 * Kept deliberately locked (owner, 2026-11-03): showing data here would remove the reason
 * to sign up.
 */

import Link from "next/link";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

const TILES = ["New listings overnight", "Price drops", "Sold this week", "Median sold vs asking"];

export default function DashboardTeaser() {
  const box = "rounded bg-black/5 dark:bg-white/10";
  const card = "rounded-lg border border-border bg-card/40 p-4";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="terminal-font text-lg font-bold uppercase tracking-wider text-foreground">Dashboard</h1>
      <p className="mt-1 max-w-2xl text-sm text-foreground/70">
        The areas you follow, the homes you saved, and what changed overnight.
      </p>

      <div className="relative mt-4 overflow-hidden">
        <div aria-hidden className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="terminal-font text-[11px] uppercase tracking-wider text-muted-foreground">Your areas</span>
            <span className={`${box} h-7 w-24`} />
            <span className={`${box} h-7 w-28`} />
            <span className={`${box} h-7 w-20`} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TILES.map((t) => (
              <div key={t} className={card}>
                <p className="text-[11px] text-muted-foreground">{t}</p>
                <div className={`${box} mt-2 h-5 w-1/2`} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className={card}>
              <p className="text-xs font-semibold text-foreground/80">What changed in your areas</p>
              <div className="mt-3 flex flex-col gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`${box} h-11`} />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className={card}>
                <p className="text-xs font-semibold text-foreground/80">Your saved homes</p>
                <div className="mt-3 flex flex-col gap-2">
                  <div className={`${box} h-14`} />
                  <div className={`${box} h-14`} />
                </div>
              </div>
              <div className={card}>
                <p className="text-xs font-semibold text-foreground/80">Neighbourhood leaderboard</p>
                <div className="mt-3 flex flex-col gap-2">
                  <div className={`${box} h-4`} />
                  <div className={`${box} h-4 w-4/5`} />
                  <div className={`${box} h-4 w-2/3`} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <VowGateOverlay
          headline="Your own dashboard, every morning"
          message="Pick your areas once. See what listed, what dropped and what sold overnight, and the homes you saved — free with one sign-in."
          ctaLabel="Set it up free →"
          next="/dashboard"
        />
      </div>

      <p className="mt-6 text-center text-sm text-foreground/60">
        Just browsing? The{" "}
        <Link href="/data" className="underline underline-offset-2 hover:text-foreground">
          public data trackers
        </Link>{" "}
        are free — no account needed.
      </p>
    </div>
  );
}
