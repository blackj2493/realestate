"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Loader2, ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Dismissible "enable one-tap sign-in" card for signed-in users who don't yet
 * have a passkey. Calls auth.registerPasskey() (the single-step WebAuthn
 * ceremony) so next time they can sign in with Face ID / fingerprint / device
 * PIN instead of an emailed code.
 *
 * Self-gating — renders nothing unless ALL of: WebAuthn is available, the user
 * isn't already enrolled (passkey.list()), and they haven't dismissed it. So it
 * can be dropped onto any authenticated surface without extra guards.
 */
const DISMISS_KEY = "pp_passkey_prompt_dismissed";

type View = "hidden" | "offer" | "saving" | "done";

export default function PasskeyPrompt() {
  const [view, setView] = useState<View>("hidden");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const supported =
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined";
    if (!supported) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    // Only offer if the user has no passkey yet. A list error (e.g. passkeys not
    // enabled on the project) keeps us hidden rather than showing a dead button.
    void createClient()
      .auth.passkey.list()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) return;
        if (data && data.length > 0) {
          localStorage.setItem(DISMISS_KEY, "1");
          return;
        }
        setView("offer");
      })
      .catch(() => {
        /* stay hidden on any unexpected failure */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setView("hidden");
  };

  const enable = async () => {
    setView("saving");
    setError("");
    try {
      const { error: err } = await createClient().auth.registerPasskey();
      if (err) throw err;
      localStorage.setItem(DISMISS_KEY, "1");
      setView("done");
    } catch (e: unknown) {
      // User dismissed the OS prompt — return to the offer, no error noise.
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setView("offer");
        return;
      }
      const msg = e instanceof Error ? e.message : "";
      setError(msg || "Couldn't set up a passkey. You can try again later.");
      setView("offer");
    }
  };

  if (view === "hidden") return null;

  if (view === "done") {
    return (
      <div className="flex items-center gap-3 border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
        <p className="terminal-font text-xs uppercase tracking-wider text-emerald-200">
          Passkey enabled — next time, just use Face ID or your fingerprint.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-3 border border-cyan-500/30 bg-cyan-500/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 p-1 text-slate-500 transition-colors hover:text-slate-300 sm:static"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6 sm:pr-0">
        <Fingerprint className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
        <div>
          <p className="terminal-font text-xs font-medium uppercase tracking-wider text-slate-100">
            Skip the email code next time
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
            Add a passkey to sign in with Face ID, your fingerprint, or your
            device PIN — no code to type.
          </p>
          {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <button
          type="button"
          onClick={dismiss}
          disabled={view === "saving"}
          className="terminal-font min-h-[40px] px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-50"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={() => void enable()}
          disabled={view === "saving"}
          className="terminal-font inline-flex min-h-[40px] items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-[11px] uppercase tracking-wider text-cyan-200 transition-colors [touch-action:manipulation] hover:bg-cyan-500/20 active:bg-cyan-500/30 disabled:opacity-50"
        >
          {view === "saving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
            </>
          ) : (
            "Enable passkey"
          )}
        </button>
      </div>
    </div>
  );
}
