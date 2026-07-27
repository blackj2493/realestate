"use client";

/**
 * "Track this address" — rung-1 lead capture on the address-profile page
 * (ADDRESS_PROFILES_PLAN P2). POSTs to /api/address-watches; the row is the lead.
 * Promise stays modest ("if it hits the market") — delivery wiring is the documented
 * follow-up, same precedent as listing_alerts.
 *
 * MEMBER-AWARE (audit #11): a signed-in user shouldn't be asked to type their email
 * under a "no account needed" headline. We detect the session client-side and, for a
 * member, render a ONE-TAP "Track this home" that reuses the same POST with the
 * account email — no field, no "no account needed" copy. Anonymous visitors are
 * unchanged (email field + "no account needed"). Follow-up: tie the watch to the
 * account's user_id server-side so it surfaces in their dashboard.
 */
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function TrackAddressCard({
  address,
  city,
  postal,
  lat,
  lng,
}: {
  address: string;
  city: string;
  postal: string | null;
  lat: number | null;
  lng: number | null;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // null = auth not resolved yet; false = anonymous; string = signed-in account email.
  const [member, setMember] = useState<string | null | false>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        // Signed in WITHOUT an email (edge case) falls through to the email form,
        // since the watch is keyed on an email address.
        setMember(data.user?.email ? data.user.email : false);
      })
      .catch(() => {
        if (!cancelled) setMember(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function track(watchEmail: string) {
    setState("busy");
    try {
      const res = await fetch("/api/address-watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: watchEmail, address, city, postal, lat, lng }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      setState(res.ok && data?.success ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  function submitAnon(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setState("error");
      return;
    }
    void track(email.trim());
  }

  return (
    <section className="mb-6 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Bell className="h-4 w-4 text-cyan-700 dark:text-cyan-400" /> Track {address}
      </p>

      {state === "done" ? (
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          Watching. We&apos;ll email you if this address hits the market. Unsubscribe anytime.
        </p>
      ) : member ? (
        /* Signed-in member → one tap, tracked to their account email. No field. */
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Be first to know if it&apos;s listed for sale — we&apos;ll alert your account.
          </p>
          <button
            type="button"
            onClick={() => void track(member)}
            disabled={state === "busy"}
            className="mt-3 inline-flex h-10 items-center rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
          >
            {state === "busy" ? "Saving…" : "Track this home"}
          </button>
          {state === "error" && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              That didn&apos;t save — please try again.
            </p>
          )}
        </>
      ) : member === null ? (
        /* Auth still resolving — show the intent + a disabled control (never the email
           field, so a member never flashes the "no account needed" capture). */
        <>
          <p className="mt-1 text-sm text-muted-foreground">Be first to know if it&apos;s listed for sale.</p>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex h-10 items-center rounded-md bg-cyan-600 px-5 text-sm font-bold text-white opacity-60"
          >
            Track this home
          </button>
        </>
      ) : (
        /* Anonymous → email capture, unchanged. */
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Be first to know if it&apos;s listed for sale — no account needed.
          </p>
          <form onSubmit={submitAnon} className="mt-3 flex max-w-md gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === "error") setState("idle");
              }}
              placeholder="you@email.com"
              aria-label="Email address"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-cyan-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={state === "busy"}
              className="h-10 shrink-0 rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
            >
              {state === "busy" ? "Saving…" : "Track"}
            </button>
          </form>
          {state === "error" && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              That didn&apos;t save — check the email address and try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
