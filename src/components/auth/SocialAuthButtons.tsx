"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { postSignInPath } from "@/lib/auth/postSignInPath";

/**
 * One-click sign-in options shown above the email-code fallback on /login:
 *   • "Continue with Google" — OAuth (PKCE). Redirects to Google and back to
 *     /auth/callback, which exchanges the code for a session cookie.
 *   • "Sign in with a passkey" — WebAuthn. signInWithPasskey() runs the browser
 *     credential ceremony and establishes the cookie session in place; we then
 *     do a full navigation so middleware/server components pick it up.
 *
 * The passkey button only renders where WebAuthn is available. Both methods land
 * the user on `next` (the email-code form handles that itself via verifyOtp).
 */
export default function SocialAuthButtons({
  next = "/dashboard",
}: {
  next?: string;
}) {
  const [busy, setBusy] = useState<null | "google" | "passkey">(null);
  const [error, setError] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    // WebAuthn capability check — only offer passkeys where the platform can do them.
    setPasskeySupported(
      typeof window !== "undefined" &&
        typeof window.PublicKeyCredential !== "undefined"
    );
  }, []);

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const signInWithGoogle = async () => {
    setBusy("google");
    setError("");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      safeNext
    )}`;
    const { error: err } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (err) {
      // On success the browser has already navigated to Google, so we only reach
      // here on failure to start the flow.
      setBusy(null);
      setError(err.message || "Couldn't start Google sign-in. Try again.");
    }
  };

  const signInWithPasskey = async () => {
    setBusy("passkey");
    setError("");
    try {
      const { error: err } = await createClient().auth.signInWithPasskey();
      if (err) throw err;
      // Route through /welcome so first-time users accept the VOW Terms before landing
      // on `next` (idempotent — accepted users pass straight through). See postSignInPath.
      window.location.assign(postSignInPath(safeNext));
    } catch (e: unknown) {
      setBusy(null);
      // User dismissed the OS prompt — stay quiet rather than scolding them.
      if (e instanceof DOMException && e.name === "NotAllowedError") return;
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg ||
          "No passkey found on this device. Use Google or an email code below, then enable a passkey from your dashboard."
      );
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        disabled={busy !== null}
        className="terminal-font flex min-h-[44px] w-full items-center justify-center gap-2.5 border border-border bg-white py-3 text-xs font-medium uppercase tracking-wider text-slate-800 transition-colors [touch-action:manipulation] hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50"
      >
        {busy === "google" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleGlyph />
        )}
        Continue with Google
      </button>

      {passkeySupported && (
        <button
          type="button"
          onClick={() => void signInWithPasskey()}
          disabled={busy !== null}
          className="terminal-font flex min-h-[44px] w-full items-center justify-center gap-2 border border-border bg-card/60 py-3 text-xs uppercase tracking-wider text-foreground transition-colors [touch-action:manipulation] hover:border-slate-500 hover:bg-muted/60 active:bg-muted disabled:opacity-50"
        >
          {busy === "passkey" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Fingerprint className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
          )}
          Sign in with a passkey
        </button>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {/* Divider between one-click options and the email-code fallback */}
      <div className="flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-muted" />
        <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
          or use email
        </span>
        <span className="h-px flex-1 bg-muted" />
      </div>
    </div>
  );
}

/** Google "G" mark (inline so we don't add an icon dependency). */
function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
