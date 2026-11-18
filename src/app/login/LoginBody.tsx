"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialAuthButtons from "@/components/auth/SocialAuthButtons";
import LoginViewTracker from "@/components/auth/LoginViewTracker";
import { loginGateFromNext, loginCopy, streetLine, type LoginGate } from "@/lib/auth/loginGate";

/** What a free account gives. Kept to three lines so the form stays above the fold. */
const BENEFITS = [
  "Sold prices and full sale history",
  "Value estimates and sold comparables",
  "Nightly alerts for the areas you follow",
];

/**
 * The /login body, read from the URL in the browser.
 *
 * WHY CLIENT-SIDE. /login used to read `?next=` on the server, which made every hit a
 * function invocation. Crawlers follow the "Sign in" link on every listing, each with its
 * own `?next=`, and Meta's AI crawler (it ignores robots.txt, which disallows /login) sent
 * ~21k of those a day (Vercel firewall, 2026-11-19). The page is now static: the CDN serves
 * the shell, and only a visitor who runs JS pays for the address lookup below.
 */
export default function LoginBody() {
  const params = useSearchParams();
  const next = params.get("next");
  const email = params.get("email");
  // Open-redirect guard: only honor relative, single-slash paths (e.g. "/properties/X").
  // No default: a bare /login must reach /welcome WITHOUT a destination, which is the
  // signal that routes a brand-new account to the map (isFirstRunEntry). Defaulting to
  // "/dashboard" here made every bare sign-in look like a sign-up from the dashboard.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  // Pre-fill from the apply funnel: only honor a plausibly-shaped address and cap length.
  const initialEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : "";
  // Name what the visitor came for (from the raw param).
  const gate = loginGateFromNext(next);
  const place = usePlace(gate);

  return (
    <LoginContent
      gate={gate}
      place={place}
      safeNext={safeNext}
      initialEmail={initialEmail}
      track
    />
  );
}

/**
 * The street line of the home the visitor was looking at, so the page can name it.
 * Best-effort: a miss only costs the address — the copy falls back to "this home".
 */
function usePlace(gate: LoginGate): string | null {
  const key =
    gate.gate === "listing" ? gate.listingKey : gate.gate === "address" ? gate.listingKey : null;
  const [place, setPlace] = useState<{ key: string; line: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/property/${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setPlace({ key, line: streetLine(d?.full_payload?.["UnparsedAddress"]) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return place && place.key === key ? place.line : null;
}

/**
 * The heading, benefits and sign-in card. Also the Suspense fallback in the static HTML
 * (gate "none", no destination) — that copy is what a crawler without JS sees, and it
 * must not fire the view event, or every visit would count twice.
 */
export function LoginContent({
  gate,
  place,
  safeNext,
  initialEmail,
  track = false,
}: {
  gate: LoginGate;
  place: string | null;
  safeNext: string | null;
  initialEmail: string;
  track?: boolean;
}) {
  const copy = loginCopy(gate, place);
  return (
    <>
      {/* Title — scale matches the apply page hero heading */}
      <div className="text-center">
        {/* Both the white fill and the heavy black glow assume a dark ground —
            scoped to dark so light mode gets dark type and no smudge. */}
        <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900 md:text-5xl dark:text-white dark:[text-shadow:0_4px_24px_rgba(0,0,0,0.7)]">
          {copy.heading}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-foreground dark:[text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
          {copy.subheading}
        </p>
        <ul className="mx-auto mt-5 flex max-w-2xl flex-col items-center gap-1.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-5">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {b}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Free — no credit card
          </li>
        </ul>
      </div>
      {track && <LoginViewTracker gate={gate.gate} />}

      {/* Card — translucent + blur to match the apply page form card */}
      <div className="mx-auto mt-10 w-full max-w-md rounded-xl border border-border bg-card p-6 backdrop-blur-md dark:bg-card/70 md:p-8">
        <div className="mb-5">
          <SocialAuthButtons next={safeNext} />
        </div>
        <MagicLinkForm next={safeNext} initialEmail={initialEmail} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New or returning — same form. Your first sign-in creates the free account.{" "}
          <Link href="/apply" className="text-cyan-700 dark:text-cyan-400 underline">
            Learn more
          </Link>
          .
        </p>

        {/* VOW compliance notice */}
        <div className="mt-6 rounded-md border border-border bg-background/60 p-4 text-[11px] leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium uppercase tracking-wider text-muted-foreground">
            VOW Access Notice
          </p>
          <p>
            Access is restricted to consumers with a bona fide interest in the purchase,
            sale, or lease of real estate, and may not be used for any commercial purpose.
          </p>
          <p className="mt-2">
            See our{" "}
            <Link href="/terms" className="text-cyan-700 dark:text-cyan-400 hover:underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-cyan-700 dark:text-cyan-400 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
