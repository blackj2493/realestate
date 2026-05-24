"use client";

import { useState } from "react";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Passwordless sign-in. Sends a Supabase magic link to the user's email; the link
 * lands on /auth/callback (PKCE) and establishes a cookie session. Magic link is
 * the primary identity and the universal fallback — passkeys (Face ID / fingerprint)
 * layer on top later without changing this flow or the data model.
 */
export default function MagicLinkForm({ next = "/dashboard" }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setStatus("sending");
    setError("");

    const supabase = createClient();
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: redirect },
    });

    if (err) {
      setStatus("error");
      setError(err.message);
    } else {
      setStatus("sent");
    }
  };

  if (status === "sent") {
    return (
      <div className="border border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
        <h3 className="terminal-font mt-3 text-sm font-bold uppercase tracking-widest text-emerald-200">
          Check your email
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          We sent a sign-in link to <span className="text-slate-100">{email.trim()}</span>.
          Open it on this device to enter the terminal.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="terminal-font mt-4 text-[11px] uppercase tracking-wider text-slate-500 underline-offset-2 hover:text-cyan-300 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label
        htmlFor="magic-email"
        className="terminal-font block text-[10px] uppercase tracking-wider text-slate-500"
      >
        Email
      </label>
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          id="magic-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="terminal-font w-full border border-slate-700 bg-slate-900/60 py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
        />
      </div>

      {status === "error" && (
        <p className="text-xs text-rose-400">{error || "Could not send the link. Try again."}</p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="terminal-font flex w-full items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 py-2.5 text-xs uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
      >
        {status === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : (
          "Send sign-in link"
        )}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-slate-600">
        No password needed. We email you a secure one-time link.
      </p>
    </form>
  );
}
