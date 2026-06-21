"use client";

import { useState } from "react";
import type { TheRead } from "@/lib/property/theRead";
import type { PersonaType } from "@/lib/personas/personaConfig";

const CHIPS: { id: PersonaType; label: string }[] = [
  { id: "cashflow", label: "Cashflow" },
  { id: "flippers", label: "Flipper" },
  { id: "smart", label: "Homebuyer" },
  { id: "builders", label: "Builder" },
];

/**
 * The Read — top-of-page synthesized verdict. Persona is client-local (chips), so the
 * card is self-contained; SSR renders `defaultPersona` for crawlers, hydration lets the
 * user switch instantly because all four theses are precomputed server-side in buildTheRead.
 */
export default function TheReadCard({
  read,
  defaultPersona = "smart",
}: {
  read: TheRead;
  defaultPersona?: PersonaType;
}) {
  const [persona, setPersona] = useState<PersonaType>(defaultPersona);

  return (
    <div data-tour="listing-the-read" className="mb-6 rounded-xl border border-emerald-500/30 bg-slate-900/40 p-4 shadow-[0_0_0_1px_rgba(52,211,153,0.06)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-300">The Read</h2>
        {read.grade && (
          <span className="ml-auto rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300">
            Deal Score {read.score} · {read.grade}
          </span>
        )}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPersona(c.id)}
            aria-pressed={persona === c.id}
            className={`min-h-[36px] whitespace-nowrap rounded-full border px-3 text-[11px] font-semibold transition-colors [touch-action:manipulation] ${
              persona === c.id
                ? "border-emerald-500/50 bg-emerald-500/[0.12] text-emerald-300"
                : "border-slate-700 text-slate-400 active:bg-slate-800"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Row label="Thesis" color="text-emerald-400" text={read.thesisByPersona[persona]} />
      <Row label="The catch" color="text-amber-400" text={read.catch_} />
      <Row label="Price read" color="text-cyan-400" text={read.priceRead} />

      <p className="mt-2 font-mono text-[10px] text-slate-600">
        Generated deterministically from Deal Score · AVM · True DOM · Value-Add. No AI on feed data (§4).
      </p>
    </div>
  );
}

function Row({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <div className="flex gap-3 border-t border-slate-800 py-2.5 first:border-t-0">
      <span className={`w-16 shrink-0 pt-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${color}`}>
        {label}
      </span>
      <span className="text-[13px] leading-relaxed text-slate-300">{text}</span>
    </div>
  );
}
