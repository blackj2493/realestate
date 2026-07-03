"use client";

/**
 * Fires the one-time welcome email on the first authenticated load, carrying the
 * pre-signup search intent captured in localStorage (see AddressSignInCta). The
 * actual send + idempotency live server-side in /api/welcome — this just nudges it.
 *
 * Mounted once in the root layout. Renders nothing.
 */

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";

const INTENT_KEY = "pp_signup_intent";
const PINGED_KEY = "pp_welcome_pinged";

export default function WelcomeOnSignup() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(PINGED_KEY)) return; // once per tab session

    let cancelled = false;
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        if (cancelled || !data.user) return;
        sessionStorage.setItem(PINGED_KEY, "1"); // guard before the async send

        let intent: unknown;
        try {
          const raw = localStorage.getItem(INTENT_KEY);
          if (raw) intent = JSON.parse(raw);
        } catch {
          /* malformed / private mode — send generic */
        }

        const res = await fetch("/api/welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent ? { intent } : {}),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean };

        if (json.ok) {
          // Sent / already-sent / opted-out — consume the intent.
          try {
            localStorage.removeItem(INTENT_KEY);
          } catch {
            /* ignore */
          }
        } else {
          // Retryable (profile not ready / mailer unconfigured) — allow a later attempt.
          sessionStorage.removeItem(PINGED_KEY);
        }
      } catch {
        sessionStorage.removeItem(PINGED_KEY);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
