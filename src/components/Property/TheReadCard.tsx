"use client";

import { useEffect, useState } from "react";
import type { EvidenceLink, TheRead } from "@/lib/property/theRead";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { onLensChanged, persistLens } from "@/lib/personas/lensPersistence";
import { track } from "@/lib/analytics/posthog";

const CHIPS: { id: PersonaType; label: string }[] = [
  { id: "cashflow", label: "Cashflow" },
  { id: "flippers", label: "Flipper" },
  { id: "smart", label: "Homebuyer" },
  { id: "builders", label: "Builder" },
];

/**
 * Scroll to the on-page card that proves a clause. Anchors are tier/status-dependent
 * (a gated card renders a teaser without its data-tour), so a missed selector falls
 * back to #financials. History is a CSS peer-checkbox collapse on mobile — expand it
 * first, then scroll (same dance as DetailMobileNav).
 */
function jumpToEvidence(target: string) {
  const el =
    document.querySelector<HTMLElement>(target) ?? document.querySelector<HTMLElement>("#financials");
  if (!el) return;
  const host = el.closest<HTMLElement>("[id]");
  const toggle = host ? document.getElementById(`${host.id}-toggle`) : null;
  if (toggle instanceof HTMLInputElement) toggle.checked = true;
  requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/**
 * The Read — top-of-page synthesized verdict. Persona is client-local (chips), so the
 * card is self-contained; SSR renders `defaultPersona` for crawlers, hydration lets the
 * user switch instantly because all four theses are precomputed server-side in buildTheRead.
 */
export default function TheReadCard({
  read,
  defaultPersona = "smart",
  listingId,
}: {
  read: TheRead;
  defaultPersona?: PersonaType;
  listingId: string;
}) {
  const [persona, setPersona] = useState<PersonaType>(defaultPersona);

  // Follow lens changes made in DealScoreCard (and persist ours symmetrically below).
  useEffect(() => onLensChanged(setPersona), []);

  const pickPersona = (p: PersonaType) => {
    setPersona(p);
    persistLens(p);
    track("read_persona_switched", { listingId, persona: p });
  };

  return (
    <div data-tour="listing-the-read" className="mb-6 rounded-xl border border-emerald-500/30 bg-card/40 p-4 shadow-[0_0_0_1px_rgba(52,211,153,0.06)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-foreground">The Read</h2>
        {read.grade && (
          <span className="ml-auto rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
            Deal Score {read.score} · {read.grade}
          </span>
        )}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pickPersona(c.id)}
            aria-pressed={persona === c.id}
            className={`min-h-[36px] whitespace-nowrap rounded-full border px-3 text-[11px] font-semibold transition-colors [touch-action:manipulation] ${
              persona === c.id
                ? "border-emerald-500/50 bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300"
                : "border-border text-muted-foreground active:bg-muted"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Row
        label="Thesis"
        color="text-emerald-700 dark:text-emerald-400"
        text={read.thesisByPersona[persona]}
        links={read.links.thesisByPersona[persona]}
        listingId={listingId}
      />
      <Row
        label="The catch"
        color="text-amber-700 dark:text-amber-400"
        text={read.catch_}
        links={read.links.catch_}
        listingId={listingId}
      />
      <Row
        label="Price read"
        color="text-cyan-700 dark:text-cyan-400"
        text={read.priceRead}
        links={read.links.price}
        listingId={listingId}
      />

      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        Generated deterministically from Deal Score · AVM · True DOM · Value-Add. No AI on feed data (§4).
      </p>
    </div>
  );
}

function Row({
  label,
  color,
  text,
  links = [],
  listingId,
}: {
  label: string;
  color: string;
  text: string;
  links?: EvidenceLink[];
  listingId: string;
}) {
  return (
    <div className="flex gap-3 border-t border-border py-2.5 first:border-t-0">
      <span className={`w-16 shrink-0 pt-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${color}`}>
        {label}
      </span>
      <span className="min-w-0 text-[13px] leading-relaxed text-foreground">
        {text}
        {links.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {links.map((l) => (
              <button
                key={l.target}
                type="button"
                onClick={() => {
                  track("read_evidence_clicked", { listingId, target: l.target });
                  jumpToEvidence(l.target);
                }}
                className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-cyan-700 active:bg-muted dark:hover:text-cyan-300"
              >
                {l.label} ↓
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
