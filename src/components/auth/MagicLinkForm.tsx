"use client";

import { useState } from "react";
import { Mail, Loader2, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Passwordless sign-in via a one-time email code (Supabase OTP; length is set by
 * the project's "Email OTP Length", commonly 6–8 digits).
 *
 * Step 1: signInWithOtp(email) → Supabase emails a code (template must include
 *         {{ .Token }}).
 * Step 2: verifyOtp(email, code, type 'email') → establishes the cookie session.
 *
 * A typed code can't be pre-consumed by email link-scanners and works across
 * devices, which sidesteps the magic-link prefetch/PKCE failures. Code is the
 * primary identity and stays passkey-ready (Face ID / fingerprint) for later.
 */
export default function MagicLinkForm({ next = "/dashboard" }: { next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "verifying">("idle");
  const [error, setError] = useState("");

  const doSend = async () => {
    const addr = email.trim();
    if (!addr) return;
    setStatus("sending");
    setError("");

    const { error: err } = await createClient().auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: true },
    });

    setStatus("idle");
    if (err) {
      setError(err.message);
    } else {
      setStep("code");
    }
  };

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void doSend();
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) return;
    setStatus("verifying");
    setError("");

    const { error: err } = await createClient().auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });

    if (err) {
      setStatus("idle");
      setError(err.message || "That code is invalid or has expired.");
      return;
    }
    // Full navigation so middleware + server components pick up the new session cookie.
    window.location.assign(next.startsWith("/") ? next : "/dashboard");
  };

  if (step === "code") {
    return (
      <form onSubmit={verify} className="space-y-3">
        <p className="text-sm text-slate-400">
          Enter the code we sent to{" "}
          <span className="text-slate-200">{email.trim()}</span>.
        </p>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id="otp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="Enter code"
            className="terminal-font w-full border border-slate-700 bg-slate-900/60 py-2.5 pl-9 pr-3 text-lg tracking-[0.4em] text-slate-200 outline-none placeholder:text-slate-600 placeholder:tracking-normal focus:border-cyan-500/60"
          />
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={status === "verifying" || code.length < 6}
          className="terminal-font flex w-full items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 py-2.5 text-xs uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {status === "verifying" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
            </>
          ) : (
            "Verify & sign in"
          )}
        </button>

        <div className="flex items-center justify-between text-[11px]">
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
            className="terminal-font uppercase tracking-wider text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            ← Change email
          </button>
          <button
            type="button"
            disabled={status === "sending"}
            onClick={() => void doSend()}
            className="terminal-font uppercase tracking-wider text-slate-500 underline-offset-2 hover:text-cyan-300 hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="space-y-3">
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
          className="terminal-font w-full border border-slate-700 bg-slate-900/60 py-2.5 pl-9 pr-3 text-base text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
        />
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        type="submit"
        disabled={status === "sending"}
        className="terminal-font flex w-full items-center justify-center gap-2 border border-cyan-500/50 bg-cyan-500/10 py-2.5 text-xs uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
      >
        {status === "sending" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending code…
          </>
        ) : (
          "Email me a sign-in code"
        )}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-slate-600">
        No password needed. We email you a one-time code that expires shortly.
      </p>
    </form>
  );
}
