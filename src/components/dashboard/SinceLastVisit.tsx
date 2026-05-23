"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchMaxEntryTimestamp, fetchCountNewerThan } from "@/lib/dashboard/queries";
import { getSeenMax, setSeenMax } from "@/lib/dashboard/config";

type State =
  | { kind: "loading" }
  | { kind: "tracking" }
  | { kind: "count"; n: number };

export default function SinceLastVisit({ location }: { location: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      const max = await fetchMaxEntryTimestamp(location);
      if (!alive) return;
      if (max == null) {
        setState({ kind: "tracking" });
        return;
      }
      const seen = getSeenMax(location);
      if (seen == null) {
        // First time we've tracked this location — establish the watermark.
        setSeenMax(location, max);
        setState({ kind: "tracking" });
        return;
      }
      const n = await fetchCountNewerThan(location, seen);
      if (!alive) return;
      setSeenMax(location, max);
      setState({ kind: "count", n });
    })().catch(() => alive && setState({ kind: "tracking" }));
    return () => {
      alive = false;
    };
  }, [location]);

  if (state.kind === "loading") {
    return (
      <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-600">
        checking…
      </span>
    );
  }
  if (state.kind === "tracking") {
    return (
      <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
        tracking from now
      </span>
    );
  }
  return (
    <span
      className={cn(
        "terminal-font text-[10px] font-bold uppercase tracking-wider",
        state.n > 0 ? "text-emerald-400" : "text-slate-500"
      )}
    >
      {state.n > 0 ? `${state.n} new since last visit` : "no new listings"}
    </span>
  );
}
