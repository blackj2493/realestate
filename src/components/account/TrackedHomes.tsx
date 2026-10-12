"use client";

/**
 * "Homes you track" on /account/emails — the address watches made with "Track this home",
 * which are keyed on email and so never appeared anywhere in the account. Listed here, beside
 * the other email choices, because a tracked home is an email subscription: one email when it
 * is listed and, if chosen, the monthly Street Recap.
 *
 * The monthly switch shows only while the recap is live (streams.ts), for the same reason the
 * preference centre hides an unarmed stream: a switch in front of an email nothing sends is a
 * quiet lie.
 */
import { useState } from "react";
import Link from "next/link";

export interface TrackedHome {
  id: number;
  address: string;
  city: string | null;
  /** The address page, or null when the address cannot be turned into one. */
  href: string | null;
  /** The monthly Street Recap for this home: true on, false declined, null never asked. */
  recap: boolean | null;
}

export default function TrackedHomes({ homes: initial, recapLive }: { homes: TrackedHome[]; recapLive: boolean }) {
  const [homes, setHomes] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // Nothing tracked and nothing just stopped: no section, rather than an empty box on a page
  // most readers open to change something else.
  if (initial.length === 0) return null;

  async function change(id: number, body: { stop: true } | { recap: boolean }) {
    setBusy(id);
    setFailed(false);
    try {
      const res = await fetch("/api/address-watches/mine", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setHomes((hs) =>
        "stop" in body ? hs.filter((h) => h.id !== id) : hs.map((h) => (h.id === id ? { ...h, recap: body.recap } : h))
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-2xl px-4 pb-10">
      <h2 className="terminal-font text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Homes you track
      </h2>
      {homes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">You no longer track any homes.</p>
      ) : (
        <ul className="mt-3 space-y-px">
          {homes.map((h) => (
            <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 border border-border bg-card/40 p-4">
              <div className="min-w-0">
                {h.href ? (
                  <Link
                    href={h.href}
                    className="text-sm font-semibold text-foreground hover:text-cyan-700 dark:hover:text-cyan-400"
                  >
                    {h.address}
                  </Link>
                ) : (
                  <span className="text-sm font-semibold text-foreground">{h.address}</span>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {h.city ? `${h.city} · ` : ""}We email you if it&apos;s listed.
                </p>
                {recapLive && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={h.recap === true}
                      disabled={busy === h.id}
                      onChange={(e) => void change(h.id, { recap: e.target.checked })}
                      className="h-4 w-4 accent-cyan-600"
                    />
                    Monthly note on what sells near it
                  </label>
                )}
              </div>
              <button
                type="button"
                disabled={busy === h.id}
                onClick={() => void change(h.id, { stop: true })}
                className="terminal-font shrink-0 text-xs uppercase tracking-wider text-cyan-700 hover:underline disabled:opacity-60 dark:text-cyan-400"
              >
                Stop tracking
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="mt-3 text-xs text-rose-700 dark:text-rose-400" aria-live="polite">
          That didn&apos;t save. Please try again.
        </p>
      )}
    </section>
  );
}
