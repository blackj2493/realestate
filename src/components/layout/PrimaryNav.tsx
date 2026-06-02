"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./navItems";

/**
 * Shared primary navigation — the same horizontal section tabs rendered in both
 * the AppHeader (every (app) page) and the terminal's TopCommandBar, so
 * navigation is identical everywhere. Active section derived from usePathname()
 * (client-only; markup matches on server/client so no hydration mismatch).
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
              "terminal-font whitespace-nowrap border-b-2 uppercase tracking-[0.2em] transition-colors",
              compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-[11px]",
              active
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-slate-400 hover:text-cyan-400"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
