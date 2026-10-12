"use client";

/**
 * "Track this home" — the address watch, as the call to action of the address pages.
 *
 * ONE CONTROL, WHERE THE READER IS. This used to be two: a hero link ("Put this home on my
 * radar") that jumped to a card at the foot of the page, and the card held the real button.
 * Two buttons for one action, and a jump that dropped the reader below content they had not
 * read. The control now sits in the profile hero (and under the header of the keyed
 * sale-record page). The parent keeps `id="track"` on its wrapper, so old #track links land.
 *
 * IT PROMISES WHAT IS DELIVERED, AND NOTHING ELSE.
 *  - Always: an email when this home is listed — the nightly address-watch phase in
 *    scripts/worker/alerts.ts. Its baseline resets when a listing leaves the market, so a
 *    later relist alerts again.
 *  - By choice: the monthly Street Recap, as a tick-box left UNTICKED (CASL does not count a
 *    pre-ticked box as consent). The box shows only while the stream is live in streams.ts,
 *    so the page never offers an email that nothing sends. Until then `recap` is not sent at
 *    all and the row stays NULL: never asked, never mailed.
 *
 * MEMBER-AWARE (audit #11): a signed-in visitor gets a one-tap button on their account email —
 * no field, no "no account needed" copy — and the done state points to where they manage it.
 * An anonymous visitor types an email, and the done state offers the free account, with that
 * email prefilled and a way back to this page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { isStreamLive } from "@/lib/email/streams";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The monthly Street Recap is offered only while something sends it (streams.ts). */
const RECAP_LIVE = isStreamLive("home_value");

const BUTTON =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-cyan-600 px-5 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-60";

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
  const pathname = usePathname();
  const [email, setEmail] = useState("");
  const [recap, setRecap] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // null = auth not resolved yet; false = anonymous; string = signed-in account email.
  const [member, setMember] = useState<string | null | false>(null);
  /** The address the watch was saved under — prefills the account offer. */
  const [savedFor, setSavedFor] = useState("");

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
        body: JSON.stringify({
          email: watchEmail,
          address,
          city,
          postal,
          lat,
          lng,
          // Sent only when the box was shown — absent means "not asked" (see the header).
          ...(RECAP_LIVE ? { recap } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (res.ok && data?.success) {
        setSavedFor(watchEmail);
        setState("done");
      } else {
        setState("error");
      }
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

  if (state === "done") {
    const back = `/login?next=${encodeURIComponent(pathname || "/")}&email=${encodeURIComponent(savedFor)}`;
    return (
      <div role="status" className="max-w-xl rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <Check className="h-4 w-4" aria-hidden /> Watching {address}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll email you if this home is listed.
          {RECAP_LIVE && recap ? " You'll also get a monthly note on what sells near it." : ""} Unsubscribe
          anytime.
        </p>
        {member ? (
          <Link
            href="/account/emails"
            className="mt-2 inline-block text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400"
          >
            Manage the homes you track →
          </Link>
        ) : (
          <Link
            href={back}
            className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Create a free account to see what homes near here sold for →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      {member ? (
        /* Signed-in member → one tap, tracked to their account email. No field. */
        <button type="button" onClick={() => void track(member)} disabled={state === "busy"} className={BUTTON}>
          <Bell className="h-4 w-4" aria-hidden />
          {state === "busy" ? "Saving…" : "Track this home"}
        </button>
      ) : member === null ? (
        /* Auth still resolving — a disabled button, never the email field, so a member
           never flashes the "no account needed" capture. */
        <button type="button" disabled className={BUTTON}>
          <Bell className="h-4 w-4" aria-hidden />
          Track this home
        </button>
      ) : (
        /* Anonymous → email capture. */
        <form onSubmit={submitAnon} className="flex flex-col gap-2 sm:flex-row">
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
          <button type="submit" disabled={state === "busy"} className={BUTTON}>
            <Bell className="h-4 w-4" aria-hidden />
            {state === "busy" ? "Saving…" : "Track this home"}
          </button>
        </form>
      )}

      {RECAP_LIVE && member !== null && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={recap}
            onChange={(e) => setRecap(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-600"
          />
          Also email me a monthly note on what sells near this home
        </label>
      )}

      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
        {member
          ? `we email ${member} if this home is listed`
          : "free · no account needed · we email you if this home is listed"}
      </p>

      {state === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {member
            ? "That didn't save — please try again."
            : "That didn't save — check the email address and try again."}
        </p>
      )}
    </div>
  );
}
