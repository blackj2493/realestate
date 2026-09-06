"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import AccountButton from "@/components/auth/AccountButton";
import InstallAppRow from "@/components/pwa/InstallAppRow";
import { NAV_ITEMS, MORE_NAV_ITEMS, isActive } from "./navItems";

/**
 * Mobile navigation — a hamburger that opens a slide-in drawer listing the same
 * NAV_ITEMS as PrimaryNav. Shown only on small screens (caller hides the inline
 * PrimaryNav at the matching breakpoint). Reuses the project's existing Radix
 * Dialog dependency (see ShareDialog) — no new package. Closes on link click.
 */
interface MobileNavProps {
  className?: string;
}

export default function MobileNav({ className }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={cn(
          "inline-flex items-center justify-center p-2 text-muted-foreground transition-colors hover:text-cyan-400",
          className
        )}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background shadow-2xl focus:outline-none">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            {/* The drawer is bg-background, which FLIPS with the theme — so the
                wordmark must follow it. Pinned theme="dark" painted the white
                #ffffff / #8fa4b8 lockup onto the light panel, where it read as
                washed out. */}
            <Logo size="md" theme="auto" />
            <Dialog.Close
              className="p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <Dialog.Title className="sr-only">Navigation</Dialog.Title>

          <nav aria-label="Primary" className="flex flex-col py-2">
            {[...NAV_ITEMS, ...MORE_NAV_ITEMS].map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "terminal-font flex items-center gap-3 px-4 py-3 text-[12px] uppercase tracking-[0.2em] transition-colors",
                    // Light-first, with the ORIGINAL dark values behind `dark:`
                    // (dark mode renders byte-identical). cyan-400 (#22d3ee) is
                    // tuned for the near-black dark panel; on the light drawer it
                    // fails contrast and the selected row read as disabled, so
                    // light gets cyan-700 (~ --dt-sig, the Daylight signal teal)
                    // over a 10% wash instead of 5%.
                    active
                      ? "border-l-2 border-cyan-700 bg-cyan-600/10 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-400/5 dark:text-cyan-400"
                      : "border-l-2 border-transparent text-foreground hover:bg-card hover:text-cyan-700 dark:hover:text-cyan-400"
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* "Install app" — the one place a user goes looking for it. Renders only
              where an install is possible right now, never once installed. */}
          <InstallAppRow onAction={() => setOpen(false)} />

          {/* Account + theme switch live here on phones — the app header hides the
              Sign in/out button below md so the full wordmark + controls fit a
              360-390px viewport (the row used to overflow and clip the hamburger). */}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <AccountButton />
            <ThemeToggle
              showLabel
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
