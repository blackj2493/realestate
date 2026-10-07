"use client";

/**
 * NarrowCityCard — the in-app half of the narrow ask (src/lib/areas/narrowAsk.ts): a reader
 * who follows ALL of Toronto or Ottawa is asked to pick the part they are looking in.
 *
 * Lives in the (app) shell beside AreaFollowPrompt, and the two never show together:
 * AreaFollowPrompt is for readers with NO area, this card for readers whose area is a whole
 * city. Not mounted on the terminal, whose bottom corner belongs to SaveHomeHint.
 *
 * It asks the server only when the bubbles store already shows a whole-city row, so an
 * anonymous visitor or a reader with ordinary areas costs no request. "Not now" snoozes
 * for 30 days on this browser; "Keep all of Toronto" ends the ask everywhere.
 */
import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { wholeCityToNarrow } from "@/lib/areas/narrowAsk";
import NarrowChooser, { type NarrowSubmit } from "@/components/areas/NarrowChooser";

const SNOOZE_KEY = "pp_narrow_card_snoozed_at";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function stampSnooze(): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
  } catch {
    /* asks again next load */
  }
}

interface Ask {
  city: string;
  suggested: { name: string; hint: string } | null;
}

export default function NarrowCityCard() {
  const init = useBubblesStore((s) => s.init);
  const loaded = useBubblesStore((s) => s.loaded);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const hasWholeCity = useBubblesStore((s) =>
    Object.values(s.items).some(
      (b) => b.area_type === "city" && b.source.kind === "city" && !!wholeCityToNarrow(b.source.city)
    )
  );

  const [ask, setAsk] = useState<Ask | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(snoozed());
    void init();
  }, [init]);

  useEffect(() => {
    if (!loaded || !signedIn || !hasWholeCity || hidden) return;
    let cancelled = false;
    fetch("/api/areas/narrow", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { asks: [] }))
      .then((b: { asks?: Ask[] }) => {
        if (!cancelled) setAsk(b.asks?.[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, signedIn, hasWholeCity, hidden]);

  if (!ask || hidden) return null;

  const submit: NarrowSubmit = async (action, part) => {
    const res = await fetch("/api/areas/narrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: ask.city, action, part }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; mapHref?: string };
    return { ok: res.ok && !!body.ok, mapHref: body.mapHref ?? null };
  };

  return (
    <div className="mx-auto my-3 max-w-5xl px-3">
      <section
        aria-label={`Pick your part of ${ask.city}`}
        className="border border-border border-l-2 border-l-cyan-500 bg-card p-3 dark:border-l-cyan-400/70"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
            <h2 className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-foreground">
              You follow all of {ask.city}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stampSnooze();
              setHidden(true);
            }}
            aria-label="Not now"
            className="-m-1 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground">
          Pick the part you are looking in, and your email covers that part only.
        </p>
        <div className="mt-2">
          <NarrowChooser
            city={ask.city}
            suggested={ask.suggested}
            submit={submit}
            compact
            // The dashboard caches its areas in this browser; reload so it reads the new ones.
            onDone={() => window.location.reload()}
          />
        </div>
      </section>
    </div>
  );
}
