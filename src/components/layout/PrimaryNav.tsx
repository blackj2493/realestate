"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { NAV_ITEMS, MORE_NAV_ITEMS, isActive } from "./navItems";

/**
 * Shared primary navigation — the same horizontal section tabs rendered in both
 * the AppHeader (every (app) page) and the terminal's TopCommandBar, so
 * navigation is identical everywhere. Active section derived from usePathname()
 * (client-only; markup matches on server/client so no hydration mismatch).
 *
 * Core sections render as inline tabs; secondary destinations (MORE_NAV_ITEMS)
 * live under a "More" dropdown so the bar stays uncluttered.
 *
 * `compact` tightens spacing for the denser h-12 terminal bar. Callers control
 * responsive visibility via `className` (e.g. "hidden md:flex" / "hidden lg:flex")
 * since the inline tabs give way to the MobileNav drawer on small screens.
 */
interface PrimaryNavProps {
  variant?: "default" | "compact";
  className?: string;
}

export default function PrimaryNav({ variant = "default", className }: PrimaryNavProps) {
  const pathname = usePathname();
  const compact = variant === "compact";

  const tabBase = cn(
    "terminal-font whitespace-nowrap border-b-2 uppercase tracking-[0.2em] transition-colors",
    compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-[11px]",
  );
  const moreActive = MORE_NAV_ITEMS.some((item) => isActive(pathname, item));

  return (
    <nav
      aria-label="Primary"
      className={cn("items-center", compact ? "gap-1" : "gap-2", className)}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              tabBase,
              active
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-muted-foreground hover:text-cyan-400",
            )}
          >
            {item.label}
          </Link>
        );
      })}

      {MORE_NAV_ITEMS.length > 0 && (
        <Popover
          align="right"
          className="w-52 p-1.5"
          trigger={
            <button
              type="button"
              aria-label="More"
              className={cn(
                tabBase,
                "flex items-center gap-1",
                moreActive
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-muted-foreground hover:text-cyan-400",
              )}
            >
              More
              <ChevronDown className="h-3 w-3" aria-hidden />
            </button>
          }
        >
          {(close) => (
            <div className="flex flex-col">
              {MORE_NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "terminal-font flex items-center gap-2.5 rounded-md px-3 py-2 text-[11px] uppercase tracking-[0.15em] transition-colors",
                      active
                        ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"
                        : "text-foreground hover:bg-muted hover:text-cyan-700 dark:hover:text-cyan-400",
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </Popover>
      )}
    </nav>
  );
}
