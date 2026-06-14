"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/hero/TopNav";
import HeroBackground from "@/components/hero/HeroBackground";
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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <HeroBackground variant="hero" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNav />

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <p className="terminal-font mb-6 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-400 md:text-base [text-shadow:0_2px_12px_rgba(0,0,0,0.7)]">
            Built for principals, not practicing agents
          </p>

          <h1 className="max-w-[95rem] text-balance font-black uppercase leading-[0.85] tracking-tight text-white text-[clamp(2.75rem,9vw,9rem)] [text-shadow:0_4px_30px_rgba(0,0,0,0.65)]">
            Real estate is a mathematical instrument.
            <br />
            <span className="text-slate-300">Stop trading blindly.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-slate-200 md:text-xl [text-shadow:0_2px_14px_rgba(0,0,0,0.8)]">
            Active and sold listings, scored on the metrics that move price.
            <br className="hidden sm:block" />
            For Ontario&apos;s top 1% of investors and developers.
          </p>

          <Link
            href="/apply"
            className="glow-emerald mt-11 inline-flex h-16 items-center justify-center rounded-md bg-emerald-500 px-12 text-base font-bold uppercase tracking-[0.15em] text-slate-950 transition-colors hover:bg-emerald-400 md:h-[4.25rem] md:px-16 md:text-lg"
          >
            Apply for Terminal Access
          </Link>

          <p className="terminal-font mt-6 text-[11px] uppercase tracking-[0.25em] text-slate-400 md:text-xs [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
            VOW compliance required · Built for serious investors, not browsers
          </p>
        </main>
      </div>
    </div>
  );
}
