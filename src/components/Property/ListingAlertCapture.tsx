"use client";

/**
 * ListingAlertCapture — a low-friction, single-field email capture on the listing page.
 *
 * Why: most organic listing-page traffic is single-listing buyer intent that gets what it
 * came for and leaves without ever signing up. A full account is too much to ask at that
 * moment; ONE field ("email me if this changes") is not. It converts that slice into a
 * re-engageable lead and gives a buyer-grade reason to come back — the highest-intent moment
 * they'll have. Rendered for anonymous visitors only (signed-in users get watchlist alerts).
 *
 * Posts to /api/listing-alerts (anonymous, rate-limited, service-role insert).
 */

import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type StatusKind = "active" | "sold" | "delisted";

/** Listing status → alert `kind` + on-card copy. */
function copyFor(statusKind: StatusKind, city?: string) {
  switch (statusKind) {
    case "delisted":
      return {
        kind: "relist",
        title: "Get a relist alert",
        sub: "It's off the market now — we'll email you the moment it's listed again.",
        placeholderDone: "We'll watch for the relist.",
      };
    case "sold":
      return {
        kind: "similar",
        title: "Get alerts for homes like this",
        sub: `We'll email you when similar homes${city ? ` in ${city}` : ""} hit the market.`,
        placeholderDone: "We'll watch for similar homes.",
      };
    case "active":
    default:
      return {
        kind: "price_status",
        title: "Get alerts on this home",
        sub: "We'll email you the moment the price drops or the status changes — no account needed.",
        placeholderDone: "We'll watch this home for you.",
      };
  }
}

export default function ListingAlertCapture({
  listingKey,
  address,
  city,
  statusKind = "active",
}: {
  listingKey: string;
  address?: string;
  city?: string;
  statusKind?: StatusKind;
}) {
  const c = copyFor(statusKind, city);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter a valid email");
      return;
    }
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/listing-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingKey, email: value, address, city, kind: c.kind }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (res.ok && json?.success) {
        setState("done");
      } else {
        setState("error");
        setError(json?.error || "Something went wrong — try again.");
      }
    } catch {
      setState("error");
      setError("Network error — try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4" role="status">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
            <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">You&apos;re all set</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {c.placeholderDone} We sent a confirmation to{" "}
              <span className="text-muted-foreground">{email.trim()}</span>. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Bell className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
        {c.title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.sub}</p>
      {/* noValidate: our stricter EMAIL_RE + inline message is the single source of truth,
          so invalid input shows on-brand copy instead of a browser-native popup. */}
      <form onSubmit={submit} noValidate className="mt-3 flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="you@email.com"
          aria-label="Email address for listing alerts"
          aria-invalid={state === "error"}
          className="min-w-0 flex-1 rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-cyan-500/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:opacity-60"
        >
          {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Alert me"}
        </button>
      </form>
      {error && (
        <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        One email when something changes. No spam, unsubscribe anytime.
      </p>
    </div>
  );
}
