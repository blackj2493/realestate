"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import Logo from "@/components/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
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

  // The header is a permanently dark navy brand band in BOTH themes (see the
  // `dark` class + .dt-header rule below), so the white wordmark is always correct.
  const logoTheme = "dark";

  // Mobile/tablet search: the inline LocationSearch is `hidden lg:block`, so below
  // lg there was otherwise no way to search from app pages (e.g. /analytics). A
  // search icon opens a full-width sheet that reuses the SAME navigate-mode
  // LocationSearch — mirroring the terminal's TopCommandBar pattern.
  const [searchOpen, setSearchOpen] = useState(false);
  // Close the sheet after any in-app navigation (selecting a result router.pushes
  // to a new route). Uses the "adjust state during render" pattern rather than a
  // setState-in-effect (https://react.dev/learn/you-might-not-need-an-effect).
  const pathname = usePathname();
  const [sheetPath, setSheetPath] = useState(pathname);
  if (pathname !== sheetPath) {
    setSheetPath(pathname);
    setSearchOpen(false);
  }
  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  return (
    <header className="dt-header dark sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 md:gap-3 md:px-4">
        <Link href={home} className="flex shrink-0 items-center" aria-label="PureProperty.ca home">
          {/* Compact mark on phones — the full ~150px wordmark is what kept blowing
              the 360-390px budget; the chevron+PURE mark frees ~100px so every
              right-cluster control (incl. the theme toggle) fits at full size. */}
          <span className="md:hidden">
            <Logo size="sm" theme={logoTheme} compact />
          </span>
          <span className="hidden md:inline-flex">
            <Logo size="md" theme={logoTheme} />
          </span>
        </Link>

        {/* Global search sits next to the logo on the left (collapses below lg). */}
        {search && <LocationSearch mode="navigate" className="hidden shrink-0 lg:block lg:w-72" />}

        {/* Spacer pushes the nav + right cluster to the edge. */}
        <div className="flex-1" />

        {/* Primary section nav — pushed to the right, before the alerts/account
            cluster. Inline on md+, drawer below (see MobileNav). */}
        {variant === "app" && <PrimaryNav className="hidden shrink-0 md:flex" />}

        {/* Phone width budget (360-390px): compact logo + tighter gap below md keep
            the full control set (incl. the theme toggle) on-screen — the cluster
            previously overflowed the row and clipped the hamburger off-screen. */}
        <div className="flex shrink-0 items-center gap-1.5 md:gap-3">
          {right}
          {/* Mobile/tablet search trigger — the inline search is hidden below lg,
              so this icon is the only way to search there (fixes /analytics et al). */}
          {search && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="inline-flex items-center justify-center p-2 text-muted-foreground transition-colors hover:text-primary lg:hidden"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
          <ThemeToggle className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary" />
          <WatchlistAlertsBell />
          <AccountButton />
          {variant === "app" && <MobileNav className="md:hidden" />}
        </div>
      </div>

      {/* Mobile/tablet full-width search sheet — reuses the SAME navigate-mode
          LocationSearch. Backdrop tap / Done / Escape close it; selecting a result
          navigates and the pathname effect above closes it. */}
      {search && searchOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col lg:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
            className="absolute inset-0 bg-background/80"
          />
          <div className="relative border-b border-border bg-card px-3 pb-3 pt-3">
            <div className="flex items-center gap-2">
              <LocationSearch mode="navigate" className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                className="flex h-11 min-w-[44px] shrink-0 items-center justify-center px-3 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <X className="mr-1 h-4 w-4" />
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
