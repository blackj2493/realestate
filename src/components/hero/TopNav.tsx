import Link from "next/link";
import Logo from "@/components/Logo";

export default function TopNav() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12 md:py-7">
      <Link href="/" className="flex items-center" aria-label="PureProperty.ca home">
        <Logo size="lg" theme="dark" />
      </Link>
      <Link
        href="/login"
        className="terminal-font text-sm tracking-[0.25em] text-slate-300 transition-colors hover:text-emerald-400 md:text-base"
      >
        [ LOGIN ]
      </Link>
    </header>
  );
}
