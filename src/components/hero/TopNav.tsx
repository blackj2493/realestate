import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function TopNav() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12 md:py-7">
      <Link href="/" className="group flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-900/70 text-slate-200 backdrop-blur-sm transition-all group-hover:border-emerald-500 group-hover:text-emerald-400 md:h-12 md:w-12">
          <ChevronLeft className="h-6 w-6 md:h-7 md:w-7" strokeWidth={3} />
        </span>
        <span className="terminal-font text-2xl font-bold tracking-tight md:text-3xl">
          <span className="text-white">PURE</span>
          <span className="text-slate-400">PROPERTY</span>
          <span className="text-emerald-400">.ca</span>
        </span>
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
