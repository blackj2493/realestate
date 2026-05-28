"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import AccountButton from "@/components/auth/AccountButton";
import WatchlistAlertsBell from "@/components/watchlist/WatchlistAlertsBell";
import PersonaSwitcher from "@/components/dashboard/PersonaSwitcher";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function MissionControlHeader({
  name,
  persona,
  onPersonaChange,
  onToggleConfig,
}: {
  name?: string;
  persona: PersonaType;
  onPersonaChange: (p: PersonaType) => void;
  onToggleConfig: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/properties?q=${encodeURIComponent(term)}` : "/properties");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link
          href="/properties"
          className="terminal-font shrink-0 text-sm font-black uppercase tracking-widest text-cyan-400"
        >
          PP.CA
        </Link>

        <form onSubmit={submit} className="relative max-w-2xl flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SEARCH PROPERTIES, ADDRESSES, MLS # OR INVESTOR QUERIES…"
            className="terminal-font w-full border border-slate-700 bg-slate-900/60 py-2 pl-9 pr-3 text-xs uppercase tracking-wider text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
          />
        </form>

        <Link
          href="/properties"
          className="terminal-font hidden border border-cyan-500/40 px-3 py-2 text-[11px] uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/10 md:inline-block"
        >
          [ Map Terminal ]
        </Link>
        <button
          type="button"
          onClick={onToggleConfig}
          className="terminal-font inline-flex shrink-0 items-center gap-1.5 border border-slate-700 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-300 transition-colors hover:border-slate-500"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
        </button>
        <WatchlistAlertsBell />
        <AccountButton />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-800/60 px-4 py-1.5">
        <span className="terminal-font text-[11px] uppercase tracking-[0.2em] text-slate-400">
          {name ? (
            <>
              Workspace: <span className="text-slate-200">{name}</span> · Mission Control
            </>
          ) : (
            "Mission Control"
          )}
        </span>
        <PersonaSwitcher persona={persona} onChange={onPersonaChange} />
      </div>
    </header>
  );
}
