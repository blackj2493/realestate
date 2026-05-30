"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import Logo from "@/components/Logo";
import AccountButton from "@/components/auth/AccountButton";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PrimaryNav from "@/components/layout/PrimaryNav";
import MobileNav from "@/components/layout/MobileNav";

/**
 * Unified application header — logo + optional global search + alerts + account.
 * Rendered once via the (app) route-group layout so every app page shares one
 * top bar. The /properties terminal keeps its own TopCommandBar instead.
 *
 * Store safety: WatchlistAlertsBell (Zustand singleton, self-hydrating) and
 * AccountButton (Supabase browser client in an effect) mount safely on any
 * page with no provider. The terminal's LocationSearch/commandCenterStore is
 * intentionally NOT used here — this search just routes to /properties?q=.
 */
interface AppHeaderProps {
  variant?: "app" | "marketing";
  search?: boolean;
  homeHref?: string;
  /** Page-specific controls rendered left of the alerts/account cluster. */
  right?: React.ReactNode;
}

export default function AppHeader({
  variant = "app",
  search = variant === "app",
  homeHref,
  right,
}: AppHeaderProps) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const home = homeHref ?? (variant === "app" ? "/dashboard" : "/");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/properties?q=${encodeURIComponent(term)}` : "/properties");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link href={home} className="flex shrink-0 items-center" aria-label="PureProperty.ca home">
          <Logo size="md" theme="dark" />
        </Link>

        {/* Primary section nav — inline on md+, drawer below (see MobileNav). */}
        {variant === "app" && <PrimaryNav className="hidden shrink-0 md:flex" />}

        {/* Spacer pushes the search + right cluster to the edge. */}
        <div className="flex-1" />

        {/* Global search collapses on smaller screens to leave room for the nav. */}
        {search && (
          <form onSubmit={submit} className="relative hidden shrink-0 lg:block lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SEARCH PROPERTIES, ADDRESSES, MLS #…"
              className="terminal-font w-full border border-slate-700 bg-slate-900/60 py-2 pl-9 pr-3 text-xs uppercase tracking-wider text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
            />
          </form>
        )}

        <div className="flex shrink-0 items-center gap-3">
          {right}
          <WatchlistAlertsBell />
          <AccountButton />
          {variant === "app" && <MobileNav className="md:hidden" />}
        </div>
      </div>
    </header>
  );
}
