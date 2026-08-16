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
          {/* FULL wordmark on every width (brand requirement — never truncate to
              "PURE"). The `sm` scale (14px) read undersized next to the 20px
              control icons, so the `md` scale (18px) now starts at 360px — the
              Android baseline — rather than at the md breakpoint.
              Budget, measured on a real 360px device: the row's free space
              between the wordmark and the first control is ~54px, and md costs
              ~36px more than sm, so ~18px stays spare. Below 360px that slack is
              gone (moving the account button into the MobileNav drawer is what
              bought it), so those viewports keep `sm` — the row used to overflow
              and clip the hamburger off-screen. */}
          <span className="xs:hidden">
            <Logo size="sm" theme={logoTheme} />
          </span>
          <span className="hidden xs:inline-flex">
            <Logo size="md" theme={logoTheme} />
          </span>
        </Link>

        {/* Global search sits next to the logo on the left (collapses below lg).
            Elastic rather than a fixed w-72: it keeps 18rem as a FLOOR (the old
            fixed width, so nothing can get tighter than it is today) and grows
            into whatever the row actually has spare, up to 26rem. A fixed width
            clipped typed addresses — "127 Via Toscana N/A, Vaughan, ON L4H 3C1"
            measures 288px against 220px of usable box — and picking wider
            breakpoints by hand is unsafe here, because the signed-in header
            carries ~114px more chrome (handle + Sign out) than the signed-out
            one, and lg is already near capacity. Letting flex do the arithmetic
            adapts to both without a breakpoint guess. The grow factor is 10
            against the spacer's 1 so the search claims the slack FIRST and
            reaches its cap; sharing it evenly left the box at its floor until
            ~1434px, which is above most laptop widths. */}
        {search && (
          <LocationSearch
            mode="navigate"
            className="hidden lg:block lg:min-w-[18rem] lg:max-w-[26rem] lg:flex-[10]"
          />
        )}

        {/* Spacer pushes the nav + right cluster to the edge. */}
        <div className="flex-1" />

        {/* Primary section nav — pushed to the right, before the alerts/account
            cluster. Inline on md+, drawer below (see MobileNav). Rendered on
            marketing pages too (/data, /glossary, /whats-my-home-hiding) so an
            SEO visitor always has a path into Map / Market Trends / Dashboard. */}
        <PrimaryNav className="hidden shrink-0 md:flex" />

        {/* Phone width budget (360-390px): smaller full wordmark + tighter gap +
            account button relocated to the drawer keep the control set (incl. the
            theme toggle) on-screen — the cluster previously overflowed the row
            and clipped the hamburger off-screen. */}
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
          {/* Sign in/out is the widest control (~90px) — below md it lives in the
              MobileNav drawer instead (both variants now render that drawer), so
              the full wordmark + controls fit a 360px viewport. */}
          <div className="hidden md:flex">
            <AccountButton />
          </div>
          <MobileNav className="md:hidden" />
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
