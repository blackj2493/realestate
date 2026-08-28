"use client";

/**
 * Email preference center UI (engagement plan WS4.1). Reads/writes /api/email-prefs.
 * Plain-language labels (voice.md §5.1 spirit — no jargon here). One master switch
 * (marketing_opt_out) plus per-stream toggles, a cadence choice, and "pause 30 days".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_EMAIL_STREAMS } from "@/lib/email/streams";

type Cadence = "standard" | "reduced" | "minimal";

interface Prefs {
  onboarding: boolean;
  alerts: boolean;
  data_drop: boolean;
  home_value: boolean;
  product: boolean;
  cadence: Cadence;
  pause_until: string | null;
  marketing_opt_out: boolean;
}

/**
 * Only the streams a sender actually exists for — see src/lib/email/streams.ts for why
 * three of migration 106's five columns are deliberately not shown. The columns and
 * /api/email-prefs are untouched, so restoring one is a one-line change there on the day
 * its sender ships.
 */
const STREAMS = LIVE_EMAIL_STREAMS;

const CADENCES: { key: Cadence; title: string; desc: string }[] = [
  { key: "standard", title: "Standard", desc: "Send emails as they happen." },
  { key: "reduced", title: "Fewer emails", desc: "At most one non-urgent email a week." },
  { key: "minimal", title: "Only the essentials", desc: "Just alerts you set and account messages." },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-cyan-600" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export default function EmailPrefsClient() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // "Now" captured once post-mount (not during render — keeps the component pure).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/email-prefs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { prefs: Prefs }) => {
        if (!alive) return;
        setPrefs(d.prefs);
        setNow(Date.now()); // in the async callback, not the effect body (stays pure)
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (override?: Partial<Prefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...override };
    setSaving(true);
    try {
      const res = await fetch("/api/email-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const pausedUntil =
    prefs?.pause_until && now && Date.parse(prefs.pause_until) > now
      ? new Date(prefs.pause_until)
      : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="terminal-font text-lg font-bold uppercase tracking-widest text-foreground">
        Email preferences
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose what we send and how often. You can change this anytime.
      </p>

      {loadError && (
        <p className="mt-8 text-sm text-rose-700 dark:text-rose-400">
          Couldn&apos;t load your preferences. Please refresh and try again.
        </p>
      )}

      {!prefs && !loadError && (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {prefs && (
        <>
          {/* Master switch */}
          <section className="mt-8 border border-border bg-card/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">All PureProperty emails</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {prefs.marketing_opt_out
                    ? "You're unsubscribed from all non-essential emails. You'll still get account and security messages."
                    : "Turn everything off in one place. Account and security emails always still send."}
                </p>
              </div>
              <Toggle
                on={!prefs.marketing_opt_out}
                label="All emails"
                onClick={() => save({ marketing_opt_out: !prefs.marketing_opt_out })}
              />
            </div>
          </section>

          {/* Per-stream toggles */}
          <fieldset
            className={cn("mt-6 space-y-px", prefs.marketing_opt_out && "pointer-events-none opacity-40")}
            aria-disabled={prefs.marketing_opt_out}
          >
            {STREAMS.map((s) => (
              <div key={s.key} className="flex items-start justify-between gap-4 border border-border bg-card/40 p-4">
                <div>
                  <div className="text-sm font-semibold text-foreground">{s.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
                </div>
                <Toggle
                  on={prefs[s.key] as boolean}
                  label={s.title}
                  onClick={() => save({ [s.key]: !(prefs[s.key] as boolean) } as Partial<Prefs>)}
                />
              </div>
            ))}
          </fieldset>

          {/* Cadence */}
          <section className={cn("mt-8", prefs.marketing_opt_out && "pointer-events-none opacity-40")}>
            <h2 className="terminal-font text-xs font-bold uppercase tracking-wider text-muted-foreground">
              How often
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {CADENCES.map((c) => {
                const on = prefs.cadence === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => save({ cadence: c.key })}
                    className={cn(
                      "border p-3 text-left transition-colors",
                      on
                        ? "border-cyan-600 bg-cyan-600/10"
                        : "border-border bg-card/40 hover:border-cyan-600/50"
                    )}
                  >
                    <div className="text-sm font-semibold text-foreground">{c.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Pause */}
          <section className={cn("mt-8", prefs.marketing_opt_out && "pointer-events-none opacity-40")}>
            <h2 className="terminal-font text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Take a break
            </h2>
            {pausedUntil ? (
              <div className="mt-3 flex items-center justify-between gap-4 border border-border bg-card/40 p-4">
                <p className="text-sm text-foreground">
                  Paused until{" "}
                  <span className="font-semibold">
                    {pausedUntil.toLocaleDateString("en-CA", { month: "long", day: "numeric" })}
                  </span>
                  .
                </p>
                <button
                  type="button"
                  onClick={() => save({ pause_until: null })}
                  className="terminal-font text-xs uppercase tracking-wider text-cyan-700 hover:underline dark:text-cyan-400"
                >
                  Resume now
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => save({ pause_until: new Date(Date.now() + 30 * 86_400_000).toISOString() })}
                className="mt-3 border border-border bg-card/40 px-4 py-2 text-sm text-foreground transition-colors hover:border-cyan-600/50"
              >
                Pause all emails for 30 days
              </button>
            )}
          </section>

          {/* Save status (changes auto-save on toggle; this confirms) */}
          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : savedAt ? (
              <>
                <Check className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" /> Saved
              </>
            ) : null}
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Back to your <Link href="/dashboard" className="text-cyan-700 hover:underline dark:text-cyan-400">dashboard</Link>.
          </p>
        </>
      )}
    </div>
  );
}
