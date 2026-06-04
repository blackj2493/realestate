"use client";

import { cn } from "@/lib/utils";
import { PERSONA_LIST, type PersonaType } from "@/lib/personas/personaConfig";

export default function LensSelector({
  lens,
  onChange,
}: {
  lens: PersonaType;
  onChange: (lens: PersonaType) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 p-0.5">
      {PERSONA_LIST.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            lens === p.id
              ? "bg-cyan-500/20 text-cyan-100"
              : "text-slate-400 hover:text-slate-200"
          )}
          title={p.label}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
