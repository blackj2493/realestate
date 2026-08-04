"use client";

/**
 * WatchlistAlertsBell — the in-app retention loop.
 *
 * One bell for everything that happened to the user's saved homes: price drops
 * AND status changes (relisted under a new MLS# / sold / leased / off-market).
 * All detection rides on useWatchlistSnapshot — the exact data layer the
 * dashboard Watchlist section renders from — so the bell and the dashboard can
 * never disagree about what happened to a saved home; the row derivation lives
 * in lib/watchlist/watchAlerts.ts (pure, unit-tested).
 *
 * The badge counts only UNSEEN alerts — a localStorage marker records the exact
 * state (price / disposition signature) last acknowledged per listing, so a
 * further cut, a fresh relist, or an off-market home resolving to "sold"
 * re-lights the bell (the variable reward), and re-opening unchanged alerts
 * does not.
 *
 * Self-contained so it can mount in any header. Deterministic comparison only
 * (no LLM, §4 compliant); disposition kinds are the public-safe badge — no VOW
 * numbers ever render here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";
import { useWatchlistSnapshot } from "@/lib/watchlist/useWatchlistSnapshot";
import {
  deriveWatchAlerts,
  normalizeSeen,
  type WatchAlert,
  type WatchAlertKind,
} from "@/lib/watchlist/watchAlerts";

const SEEN_KEY = "pp_alerts_seen";

function readSeen(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? normalizeSeen(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

/** Status-chip palette — hue-matched to the dashboard's StatusLight tones
 *  (relisted=cyan, sold=rose, leased=violet, off=amber). */
const STATUS_CHIP: Record<Exclude<WatchAlertKind, "drop">, { label: string; className: string }> = {
  relisted: { label: "Relisted", className: "bg-cyan-600/15 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300" },
  sold: { label: "Sold", className: "bg-rose-600/15 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
  leased: { label: "Leased", className: "bg-violet-600/15 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  off: { label: "Off market", className: "bg-amber-600/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
};

function statusLine(a: WatchAlert): string {
  switch (a.kind) {
    case "relisted":
      return a.relistPrice
        ? `Back on the market at ${formatPrice(a.relistPrice)}`
        : "Back on the market under a new listing";
    case "sold":
      return "This home has sold";
    case "leased":
      return "This home has been leased";
    default:
      return "No longer on the market";
  }
}

function AlertRow({ alert, onNavigate }: { alert: WatchAlert; onNavigate: () => void }) {
  const isDrop = alert.kind === "drop";
  return (
    <Link
      href={alert.href}
      onClick={onNavigate}
      className="flex items-start gap-3 border-b border-border/60 px-3 py-2.5 transition-colors hover:bg-card/60"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{alert.address}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {isDrop ? (
            <>
              <span className="text-muted-foreground line-through">{formatPrice(alert.oldPrice!)}</span>{" "}
              <span className="font-mono text-emerald-700 dark:text-emerald-400">{formatPrice(alert.newPrice!)}</span>
            </>
          ) : (
            statusLine(alert)
          )}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-bold",
          isDrop
            ? "bg-rose-600/15 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
            : STATUS_CHIP[alert.kind as Exclude<WatchAlertKind, "drop">].className
        )}
      >
        {isDrop ? `-${alert.dropPct}%` : STATUS_CHIP[alert.kind as Exclude<WatchAlertKind, "drop">].label}
      </span>
    </Link>
  );
}

export default function WatchlistAlertsBell({ className }: { className?: string }) {
  const init = useWatchlistStore((s) => s.init);
  const { changes } = useWatchlistSnapshot();

  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const seenLoaded = useRef(false);

  // Hydrate the watchlist store (idempotent) and the seen-marker once.
  useEffect(() => {
    void init();
    if (!seenLoaded.current) {
      seenLoaded.current = true;
      setSeen(readSeen());
    }
  }, [init]);

  const alerts = useMemo(() => deriveWatchAlerts(changes), [changes]);
  const watchedCount = changes.length;

  // An alert is "unseen" until the user has acknowledged this exact state.
  const unseenCount = useMemo(
    () => alerts.filter((a) => seen[a.id] !== a.sig).length,
    [alerts, seen]
  );

  // Opening the panel acknowledges every current alert at its current state.
  const handleOpen = () => {
    setOpen(true);
    if (alerts.length > 0) {
      const next = { ...seen };
      for (const a of alerts) next[a.id] = a.sig;
      setSeen(next);
      writeSeen(next);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        data-tour="watchlist-alerts"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        aria-label={`Watchlist alerts${unseenCount ? ` (${unseenCount} new)` : ""}`}
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center border border-border text-foreground transition-colors hover:border-cyan-500/60 hover:text-cyan-300"
      >
        <Bell className="h-4 w-4" />
        {unseenCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop closes the panel */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-11 z-50 w-[min(20rem,calc(100vw-1rem))] border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Watchlist Alerts
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-my-2 -mr-1 inline-flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close alerts"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto pb-safe">
              {alerts.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  {watchedCount === 0 ? (
                    <>
                      <p className="text-xs font-medium text-foreground">No watched homes yet</p>
                      <p className="mx-auto mt-1 max-w-[15rem] text-[11px] leading-relaxed text-muted-foreground">
                        Save homes you like and we&apos;ll watch them — a price drop or status change
                        lights up this bell.
                      </p>
                      <Link
                        href="/properties"
                        onClick={() => setOpen(false)}
                        className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-cyan-500/50 bg-cyan-500/10 px-4 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
                      >
                        Browse homes
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-foreground">You&apos;re all caught up</p>
                      <p className="mx-auto mt-1 max-w-[15rem] text-[11px] leading-relaxed text-muted-foreground">
                        Nothing new on your {watchedCount} watched home{watchedCount === 1 ? "" : "s"}
                        {" "}— we&apos;ll email you the moment a price drops or one changes status.
                      </p>
                      <Link
                        href="/dashboard"
                        onClick={() => setOpen(false)}
                        className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-cyan-500/50 bg-cyan-500/10 px-4 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
                      >
                        Manage alerts
                      </Link>
                    </>
                  )}
                </div>
              ) : (
                alerts.map((a) => <AlertRow key={a.id} alert={a} onNavigate={() => setOpen(false)} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
