"use client";

/**
 * Your Take — private per-listing note + personal deal-breaker auto-screen.
 *
 * Anonymous-first localStorage (mirrors useScenarios' readLocal/writeLocal idiom):
 *   - `pp_deal_rules`    → one global RuleSet, applied to every listing.
 *   - `pp_listing_notes` → map keyed by listing_key → note text.
 * Supabase cross-device sync can be added later behind the same pattern as useScenarios
 * (needs a table → deferred so this ships without a migration).
 *
 * Hydration: server render + first client render both use defaults (empty note / no
 * rules), then localStorage is read in useEffect — so there is no hydration mismatch.
 */

import { useEffect, useRef, useState } from "react";
import {
  evaluateRules,
  failCount,
  activeRuleCount,
  DEFAULT_RULES,
  type RuleSet,
  type ListingMetrics,
} from "@/lib/property/dealBreakers";

const RULES_KEY = "pp_deal_rules";
const NOTES_KEY = "pp_listing_notes";

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / serialization errors */
  }
}

const RULE_FIELDS: { key: keyof RuleSet; label: string; suffix?: string; prefix?: string; scale?: number; placeholder: string }[] = [
  { key: "minCapRatePct", label: "Min cap", suffix: "%", placeholder: "5" },
  { key: "maxPrice", label: "Max price", prefix: "$", suffix: "K", scale: 1000, placeholder: "900" },
  { key: "minBeds", label: "Min beds", placeholder: "3" },
  { key: "minTrueDom", label: "Min True DOM", suffix: "d", placeholder: "21" },
];

export default function YourTakeCard({
  listingKey,
  metrics,
}: {
  listingKey: string;
  metrics: ListingMetrics;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [rules, setRules] = useState<RuleSet>(DEFAULT_RULES);
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setRules(readJSON<RuleSet>(RULES_KEY, DEFAULT_RULES));
    const notes = readJSON<Record<string, string>>(NOTES_KEY, {});
    setNote(notes[listingKey] ?? "");
    setHydrated(true);
  }, [listingKey]);

  function updateRule(key: keyof RuleSet, raw: string, scale = 1) {
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    const value = parsed != null && Number.isFinite(parsed) ? parsed * scale : null;
    const next = { ...rules, [key]: value };
    setRules(next);
    writeJSON(RULES_KEY, next);
  }

  function updateNote(value: string) {
    setNote(value);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      const notes = readJSON<Record<string, string>>(NOTES_KEY, {});
      if (value.trim()) notes[listingKey] = value;
      else delete notes[listingKey];
      writeJSON(NOTES_KEY, notes);
    }, 400);
  }

  const results = hydrated ? evaluateRules(metrics, rules) : [];
  const fails = failCount(results);
  const active = activeRuleCount(rules);

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-300">Your Take</h3>
        <span className="ml-auto font-mono text-[10px] font-semibold text-slate-500">private · on this device</span>
      </div>

      {/* Deal-breaker auto-screen */}
      <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        {RULE_FIELDS.map((f) => {
          const stored = rules[f.key];
          const shown = stored == null ? "" : String(f.scale ? stored / f.scale : stored);
          return (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wide text-slate-500">{f.label}</span>
              <span className="flex items-center gap-0.5 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1">
                {f.prefix && <span className="text-[11px] text-slate-500">{f.prefix}</span>}
                <input
                  inputMode="decimal"
                  defaultValue={shown}
                  key={`${f.key}-${hydrated}`} /* re-seed defaultValue after hydration */
                  onChange={(e) => updateRule(f.key, e.target.value, f.scale ?? 1)}
                  placeholder={f.placeholder}
                  className="w-12 bg-transparent text-base font-mono text-slate-200 outline-none placeholder:text-slate-600"
                />
                {f.suffix && <span className="text-[11px] text-slate-500">{f.suffix}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {/* Verdict against the rules */}
      {active === 0 ? (
        <p className="mb-3 text-[11px] text-slate-500">Set your deal-breakers above to auto-screen every listing.</p>
      ) : (
        <div className="mb-3">
          <p className={`mb-1.5 font-mono text-[11px] font-bold ${fails > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {fails > 0 ? `⚑ Fails ${fails} of your ${active} rule${active === 1 ? "" : "s"}` : `✓ Meets all ${active} of your rules`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {results.map((r) => (
              <span
                key={r.key}
                title={r.detail}
                className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  r.status === "fail"
                    ? "bg-rose-500/12 text-rose-300"
                    : r.status === "pass"
                      ? "bg-emerald-500/12 text-emerald-300"
                      : "bg-slate-700/40 text-slate-400"
                }`}
              >
                {r.status === "fail" ? "✕" : r.status === "pass" ? "✓" : "?"} {r.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Private note */}
      <textarea
        value={note}
        onChange={(e) => updateNote(e.target.value)}
        rows={2}
        placeholder="Private note — only you, only this device. e.g. 'confirm reserve fund · lowball at 860'"
        className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-base text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-700"
      />
    </div>
  );
}
