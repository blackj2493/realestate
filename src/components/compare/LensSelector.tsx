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
    <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
      {PERSONA_LIST.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={cn(
            "flex min-h-[44px] items-center justify-center rounded px-2.5 py-2.5 text-xs font-medium transition-colors md:min-h-0 md:py-1",
            // text-cyan-100 alone is a DARK-surface colour: on the compare page's light
            // background it sat on bg-cyan-500/20 as pale-on-pale and the active lens was
            // unreadable. Dark mode keeps the exact previous colour.
            lens === p.id
              ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={p.label}
        >
          <span className="md:hidden">{p.short ?? p.label}</span>
          <span className="hidden md:inline">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
