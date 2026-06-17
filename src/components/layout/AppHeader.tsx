"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import AccountButton from "@/components/auth/AccountButton";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PrimaryNav from "@/components/layout/PrimaryNav";
import MobileNav from "@/components/layout/MobileNav";
import LocationSearch from "@/components/CommandCenter/LocationSearch";

/**
 * Unified application header — logo + optional global search + alerts + account.
 * Rendered once via the (app) route-group layout so every app page shares one
 * top bar. The /properties terminal keeps its own TopCommandBar instead.
 *
 * Store safety: WatchlistAlertsBell (Zustand singleton, self-hydrating) and
 * AccountButton (Supabase browser client in an effect) mount safely on any
 * page with no provider. Off the terminal the shared LocationSearch runs in
 * "navigate" mode — selecting a result router.pushes to /properties?city= or
 * the listing detail page rather than writing to commandCenterStore, which it
 * never writes to in navigate mode.
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
  const home = homeHref ?? (variant === "app" ? "/dashboard" : "/");

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 md:gap-3 md:px-4">
        <Link href={home} className="flex shrink-0 items-center" aria-label="PureProperty.ca home">
          {/* Smaller wordmark on phones so the logo + right cluster fit a 390px
              viewport without forcing the layout wider (which clips the nav button). */}
          <span className="md:hidden">
            <Logo size="sm" theme="dark" />
          </span>
          <span className="hidden md:inline-flex">
            <Logo size="md" theme="dark" />
          </span>
        </Link>

        {/* Global search sits next to the logo on the left (collapses below lg). */}
        {search && <LocationSearch mode="navigate" className="hidden shrink-0 lg:block lg:w-72" />}

        {/* Spacer pushes the nav + right cluster to the edge. */}
        <div className="flex-1" />

        {/* Primary section nav — pushed to the right, before the alerts/account
            cluster. Inline on md+, drawer below (see MobileNav). */}
        {variant === "app" && <PrimaryNav className="hidden shrink-0 md:flex" />}

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
