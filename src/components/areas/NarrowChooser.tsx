"use client";

/**
 * NarrowChooser — "pick the part of Toronto you are looking in", with Switch / Keep / Undo.
 *
 * One component for both surfaces of the narrow ask: the page the digest links to
 * (/areas/narrow, signed by the email link) and the in-app card. The caller supplies
 * `submit`, which is the only thing that differs (which route, which auth).
 *
 * Nothing is saved until the reader presses Switch or Keep. Every outcome says what changed
 * and offers the way back, because replacing an area is the kind of change a reader must be
 * able to see and undo (migration 144's rule).
 */
import { useState } from "react";
import { Check } from "lucide-react";
import CityPartChips from "@/components/areas/CityPartChips";
import { partsOf } from "@/lib/dashboard/cityParts";

export type NarrowSubmit = (
  action: "switch" | "keep" | "undo",
  part?: string
) => Promise<{ ok: boolean; mapHref?: string | null }>;

export default function NarrowChooser({
  city,
  suggested,
  submit,
  compact = false,
  onDone,
}: {
  city: string;
  /** The part most of the reader's opened homes sit in, pre-selected. */
  suggested?: { name: string; hint: string } | null;
  submit: NarrowSubmit;
  /** Card layout (in-app) rather than a full page. */
  compact?: boolean;
  /** Called after a final answer (switch or keep) so a card can retire itself. */
  onDone?: () => void;
}) {
  const parts = partsOf(city) ?? [];
  const [chosen, setChosen] = useState<string | null>(suggested?.name ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<
    | { kind: "switched"; part: string; mapHref: string | null }
    | { kind: "kept"; mapHref: string | null }
    | { kind: "undone" }
    | null
  >(null);

  const run = async (action: "switch" | "keep" | "undo", part?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await submit(action, part);
      if (!r.ok) throw new Error("failed");
      if (action === "switch" && part) setResult({ kind: "switched", part, mapHref: r.mapHref ?? null });
      else if (action === "keep") setResult({ kind: "kept", mapHref: r.mapHref ?? null });
      else setResult({ kind: "undone" });
    } catch {
      setError("We could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const link = "text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400";

  if (result?.kind === "switched") {
    return (
      <div aria-live="polite" className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            You now follow <strong>{result.part}</strong>. Your next email covers {result.part} only.
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {result.mapHref && (
            <a href={result.mapHref} className={link}>
              See {result.part} on the map &rarr;
            </a>
          )}
          <button type="button" disabled={busy} onClick={() => run("undo", result.part)} className={link}>
            Undo, keep all of {city}
          </button>
          {compact && onDone && (
            <button type="button" onClick={onDone} className="text-sm text-muted-foreground hover:text-foreground">
              Close
            </button>
          )}
        </div>
        {error && <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>}
      </div>
    );
  }

  if (result?.kind === "kept") {
    return (
      <div aria-live="polite" className="space-y-3">
        <p className="text-sm text-foreground">
          You keep all of {city}. We will not ask again. You can pick a part any time on your dashboard.
        </p>
        {compact && onDone ? (
          <button type="button" onClick={onDone} className={link}>
            Close
          </button>
        ) : (
          result.mapHref && (
            <a href={result.mapHref} className={link}>
              Open {city} on the map &rarr;
            </a>
          )
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {result?.kind === "undone" && (
        <p aria-live="polite" className="text-sm text-foreground">
          You follow all of {city} again.
        </p>
      )}
      {suggested && (
        <p className="text-sm text-foreground">
          Most of the homes you opened are in <strong>{suggested.name}</strong>
          <span className="text-muted-foreground"> ({suggested.hint})</span>.
        </p>
      )}
      <CityPartChips parent={city} parts={parts} selected={chosen} onPick={setChosen} disabled={busy} />
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          type="button"
          disabled={!chosen || busy}
          onClick={() => chosen && run("switch", chosen)}
          className="inline-flex min-h-[44px] items-center rounded-md bg-emerald-500 px-4 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50 md:min-h-[40px]"
        >
          {chosen ? `Switch to ${chosen}` : "Pick a part"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run("keep")}
          className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Keep all of {city}
        </button>
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>}
    </div>
  );
}
