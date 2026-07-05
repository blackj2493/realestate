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
  purchaseOnlyRuleCount,
  PURCHASE_ONLY_RULES,
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
  isLease = false,
}: {
  listingKey: string;
  metrics: ListingMetrics;
  /** Lease listings skip the purchase-only rules (cap rate, max price) in the auto-screen. */
  isLease?: boolean;
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

  const results = hydrated ? evaluateRules(metrics, rules, { isLease }) : [];
  const fails = failCount(results);
  // active = rules actually evaluated for THIS listing (purchase-only rules are dropped
  // on leases), so the verdict count matches the chips shown.
  const active = results.length;
  // Purchase-only rules the user set but which don't apply here (lease) → explain, don't ghost-pass.
  const skippedPurchaseRules = hydrated && isLease ? purchaseOnlyRuleCount(rules) : 0;

  return (
    <div className="mb-6 rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.09em] text-foreground">Your Take</h3>
        <span className="ml-auto font-mono text-[10px] font-semibold text-muted-foreground">private · on this device</span>
      </div>

      {/* Deal-breaker auto-screen */}
      <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        {RULE_FIELDS.map((f) => {
          const stored = rules[f.key];
          const shown = stored == null ? "" : String(f.scale ? stored / f.scale : stored);
          // Purchase-only rules (cap rate, max price) don't apply to a lease — dim the
          // input and flag it, but keep it editable (rules are global across listings).
          const na = isLease && PURCHASE_ONLY_RULES.has(f.key);
          return (
            <label
              key={f.key}
              className={`flex flex-col gap-1 ${na ? "opacity-40" : ""}`}
              title={na ? "Doesn't apply to lease listings" : undefined}
            >
              <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
              <span className="flex items-center gap-0.5 rounded-md border border-border bg-background/60 px-2 py-1">
                {f.prefix && <span className="text-[11px] text-muted-foreground">{f.prefix}</span>}
                <input
                  inputMode="decimal"
                  defaultValue={shown}
                  key={`${f.key}-${hydrated}`} /* re-seed defaultValue after hydration */
                  onChange={(e) => updateRule(f.key, e.target.value, f.scale ?? 1)}
                  placeholder={f.placeholder}
                  className="w-12 bg-transparent text-base font-mono text-foreground outline-none placeholder:text-muted-foreground"
                />
                {f.suffix && <span className="text-[11px] text-muted-foreground">{f.suffix}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {/* Verdict against the rules */}
      {active === 0 ? (
        <p className="mb-3 text-[11px] text-muted-foreground">
          {skippedPurchaseRules > 0
            ? "Your cap-rate & price filters don't apply to leases — set a beds or True DOM rule to screen rentals."
            : "Set your deal-breakers above to auto-screen every listing."}
        </p>
      ) : (
        <div className="mb-3">
          <p className={`mb-1.5 font-mono text-[11px] font-bold ${fails > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
            {fails > 0 ? `⚑ Fails ${fails} of your ${active} rule${active === 1 ? "" : "s"}` : `✓ Meets all ${active} of your rule${active === 1 ? "" : "s"}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {results.map((r) => (
              <span
                key={r.key}
                title={r.detail}
                className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  r.status === "fail"
                    ? "bg-rose-500/12 text-rose-700 dark:text-rose-300"
                    : r.status === "pass"
                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {r.status === "fail" ? "✕" : r.status === "pass" ? "✓" : "?"} {r.label}
              </span>
            ))}
          </div>
          {skippedPurchaseRules > 0 && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">Cap-rate & price filters skipped — they don&apos;t apply to leases.</p>
          )}
        </div>
      )}

      {/* Private note */}
      <textarea
        value={note}
        onChange={(e) => updateNote(e.target.value)}
        rows={2}
        placeholder="Private note — only you, only this device. e.g. 'confirm reserve fund · lowball at 860'"
        className="w-full resize-none rounded-lg border border-border bg-background/60 p-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
      />
    </div>
  );
}
