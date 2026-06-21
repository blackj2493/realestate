import Link from "next/link";
import Logo from "@/components/Logo";

export default function TopNav() {
  return (
    <header className="pt-safe relative z-10 flex items-center justify-between gap-3 px-6 py-5 md:px-12 md:py-7">
      <Link href="/" className="flex min-w-0 items-center" aria-label="PureProperty.ca home">
        {/* Smaller mark on phones so the wordmark never collides with the LOGIN link;
            full size from md up. */}
        <span className="md:hidden">
          <Logo size="md" theme="dark" />
        </span>
        <span className="hidden md:inline-flex">
          <Logo size="lg" theme="dark" />
        </span>
      </Link>
      <Link
        href="/login"
        className="terminal-font inline-flex h-11 shrink-0 items-center px-2 text-sm tracking-[0.15em] text-slate-300 transition-colors hover:text-emerald-400 active:text-emerald-300 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 [touch-action:manipulation] md:text-base md:tracking-[0.25em]"
      >
        [ LOGIN ]
      </Link>
    </header>
  );
}
