"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/hero/TopNav";
import HeroBackground from "@/components/hero/HeroBackground";
import ListingCompare from "@/components/hero/ListingCompare";
import { createClient } from "@/lib/supabase/browser";

export default function HomePage() {
  const router = useRouter();
  // Returning SIGNED-IN users are routed straight to Mission Control. Anonymous
  // visitors (95%+) see the hero immediately — no blank screen while auth resolves.
  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (!active) return;
      if (user) router.replace("/dashboard");
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="relative min-h-app overflow-hidden bg-background text-foreground">
      <HeroBackground variant="hero" />

      <div className="relative z-10 flex min-h-app flex-col">
        <TopNav />

        {/* Hero — compact so the comparison cards AND the CTA stay above the fold */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-5 text-center">
          <p className="terminal-font mb-5 text-[14.4px] font-semibold uppercase tracking-[0.3em] text-emerald-700 dark:text-emerald-400 md:text-[16.8px] [text-shadow:0_2px_12px_rgba(0,0,0,0.7)]">
            For serious buyers &amp; investors — not browsers
          </p>

          <h1 className="max-w-[66rem] text-balance font-black uppercase leading-[0.92] tracking-tight text-white text-[clamp(2.4rem,5.76vw,4.62rem)] [text-shadow:0_4px_30px_rgba(0,0,0,0.65)]">
            See every listing like the smart money does.
            <br />
            <span className="text-foreground">Before you bid, not after you close.</span>
          </h1>

          <p className="mt-5 max-w-[44rem] text-[16.8px] leading-relaxed text-foreground md:text-[18px] [text-shadow:0_2px_14px_rgba(0,0,0,0.8)]">
            The same listing — on every other platform, and on PureProperty:
          </p>

          {/* The comparison: sparse consumer card vs. our decoded intelligence card */}
          <ListingCompare />

          <Link
            href="/apply"
            className="glow-emerald mt-7 inline-flex h-[3.25rem] items-center justify-center rounded-md bg-emerald-500 px-12 text-base font-bold uppercase tracking-[0.15em] text-slate-950 transition-colors hover:bg-emerald-400"
          >
            Apply for Terminal Access
          </Link>

          {/* Secondary ghost CTA: lets cold/anonymous visitors reach the terminal
              without the high-friction application form. */}
          <Link
            href="/properties"
            className="terminal-font mt-3.5 inline-flex h-10 items-center justify-center rounded-md border border-border/70 px-6 text-[13px] tracking-[0.2em] text-foreground transition-colors hover:border-emerald-400/60 hover:text-emerald-300 active:text-emerald-300 [touch-action:manipulation] [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]"
          >
            Explore the Terminal &rarr;
          </Link>

          {/* Crawlable entry to the city-hub directory — Googlebot can't crawl the
              client-only terminal above, so this is the top of the SEO hub tree. */}
          <Link
            href="/property"
            className="terminal-font mt-3.5 text-[11px] uppercase tracking-[0.22em] text-muted-foreground underline-offset-4 transition-colors hover:text-emerald-300 hover:underline [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]"
          >
            Browse homes by city &rarr;
          </Link>

          <p className="terminal-font mt-5 text-[11px] uppercase tracking-[0.22em] text-muted-foreground [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
            VOW compliance required · Built for serious investors, not browsers
          </p>
          {/* TRESA / VOW §6.3(e): brokerage-identity disclosure, kept low-key as a link. */}
          <Link
            href="/operated-by"
            className="terminal-font mt-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground underline-offset-4 transition-colors hover:text-emerald-300 hover:underline [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]"
          >
            Operated under licence
          </Link>
        </main>
      </div>
    </div>
  );
}
