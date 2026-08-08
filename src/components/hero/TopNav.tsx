import Link from "next/link";
import Logo from "@/components/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function TopNav() {
  return (
    <header className="pt-safe relative z-10 flex items-center justify-between gap-3 px-6 py-5 md:px-12 md:py-7">
      <Link href="/" className="flex min-w-0 items-center" aria-label="PureProperty.ca home">
        {/* Smaller mark on phones so the wordmark never collides with the LOGIN link;
            full size from md up. */}
        {/* theme="auto" so the wordmark follows the app theme — navy on the light hero,
            white on the dark hero. Hardcoded "dark" left PURE white → washed on light. */}
        <span className="md:hidden">
          <Logo size="md" theme="auto" />
        </span>
        <span className="hidden md:inline-flex">
          <Logo size="lg" theme="auto" />
        </span>
      </Link>
      {/* The app defaults to light for everyone, so the escape hatch to dark has to live
          HERE too — this page renders TopNav, not AppHeader, so it never inherited the
          header's toggle and a signed-out visitor had no way back to the terminal look.
          Borderless to sit quietly over the hero map rather than reading as a second CTA
          next to [ LOGIN ]. */}
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 dark:hover:text-emerald-400 [touch-action:manipulation]" />
        <Link
          href="/login"
          className="terminal-font inline-flex h-11 shrink-0 items-center px-2 text-sm tracking-[0.15em] text-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400 active:text-emerald-300 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 [touch-action:manipulation] md:text-base md:tracking-[0.25em]"
        >
          [ LOGIN ]
        </Link>
      </div>
    </header>
  );
}
