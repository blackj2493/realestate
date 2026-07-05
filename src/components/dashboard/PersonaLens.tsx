"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import PersonaMenuList from "@/components/personas/PersonaMenuList";
import { PERSONA_CONFIG, type PersonaType } from "@/lib/personas/personaConfig";
import { useDiscovery } from "@/lib/discovery/useDiscovery";

/**
 * Elevated gold "lens" persona selector — the shared centerpiece control used by
 * BOTH Mission Control (dashboard) and the Command Center (terminal). Same gold
 * trigger + option list (PersonaMenuList) on every surface, so the two selectors
 * are visually one control; only the caption text and density differ. Controlled:
 * each surface owns its own persona state (dashboard config vs. command-center
 * store).
 *
 * Layout is caption-ABOVE-button so the button is horizontally centered in its
 * container regardless of caption width (the previous terminal chip sat beside an
 * inline label, which pushed the button off-center). The caption is optional —
 * the dashboard hero shows one ("Viewing your dashboard as"); the dense terminal
 * bar omits it (the gold button alone is self-evident) to stay uncongested.
 *
 * `compact` (terminal): denser padding, and below `sm` the button collapses to
 * icon + chevron so it fits the crowded top bar.
 */
export default function PersonaLens({
  persona,
  onChange,
  caption,
  compact = false,
  short = false,
  dataTour,
}: {
  persona: PersonaType;
  onChange: (p: PersonaType) => void;
  /** Small label shown above the button. Omit on dense bars to avoid clutter. */
  caption?: string;
  compact?: boolean;
  /** Use the persona's short name (e.g. "Flipper") so the button stays one line in
   *  narrow rows like the mobile terminal lens. Falls back to the full label. */
  short?: boolean;
  /** Optional discovery spotlight anchor (e.g. "dashboard-persona"). */
  dataTour?: string;
}) {
  const active = PERSONA_CONFIG[persona];
  const ActiveIcon = active.icon;
  const label = short ? active.short ?? active.label : active.label;

  // Trigger is a <span>, not a <button>: Popover supplies the click handler on
  // its own wrapper <div>, and nesting interactive elements breaks a11y /
  // hydration.
  const trigger = (
    <span
      data-tour={dataTour}
      className={cn(
        "terminal-font group flex cursor-pointer items-center border transition-colors",
        // LIGHT (Daylight) — a solid gold pill so the hero control pops off the
        // pale ground (a translucent tint reads as washed out on white).
        "border-[color:var(--dt-gold-line)] bg-[color:var(--dt-gold)] text-white shadow-[0_2px_12px_-2px_rgba(196,125,16,0.6)] hover:bg-[#b06e0c]",
        // DARK (main mode) — the original elevated glass-gold lens, unchanged.
        "dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-300 dark:shadow-[0_0_24px_-6px_rgba(251,191,36,0.55)] dark:hover:border-amber-300/80 dark:hover:bg-amber-400/20",
        compact ? "gap-2 px-3 py-2" : "gap-2.5 px-4 py-2.5"
      )}
    >
      <ActiveIcon className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      {/* Compact (terminal): label hides on phones so the chip can't overflow onto
          the search/bell in the crowded top row; sm+ shows it. */}
      <span
        className={cn(
          "font-semibold uppercase tracking-[0.15em]",
          compact ? "hidden text-xs sm:inline" : "text-sm"
        )}
      >
        {label}
      </span>
      <ChevronDown
        className={cn(
          "shrink-0 opacity-70 transition-transform group-hover:translate-y-0.5",
          compact ? "h-3.5 w-3.5" : "h-4 w-4"
        )}
      />
    </span>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      {caption && (
        <span className="terminal-font text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {caption}
        </span>
      )}
      <Popover trigger={trigger} className="w-60 p-1">
        {(close) => (
          <PersonaMenuList
            value={persona}
            heading="Switch persona"
            onSelect={(p) => {
              if (dataTour) useDiscovery.getState().markUsed(dataTour);
              onChange(p);
              close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}
