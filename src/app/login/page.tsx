import Link from "next/link";
import { Check } from "lucide-react";
import Logo from "@/components/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialAuthButtons from "@/components/auth/SocialAuthButtons";
import LoginViewTracker from "@/components/auth/LoginViewTracker";
import { loginGateFromNext, loginCopy, streetLine, type LoginGate } from "@/lib/auth/loginGate";
import { getListingDetailCached } from "@/lib/property/getListingDetailCached";

export const metadata = {
  title: "Sign in or create a free account · PureProperty.ca",
};

/**
 * The street line of the home the visitor was looking at, so the page can name it.
 * Best-effort: it is the same cached read the listing page just did (warm in the common
 * flow), and a miss only costs the address — the copy falls back to "this home".
 */
async function placeFor(gate: LoginGate): Promise<string | null> {
  const key =
    gate.gate === "listing" ? gate.listingKey : gate.gate === "address" ? gate.listingKey : null;
  if (!key) return null;
  try {
    const detail = await getListingDetailCached(key);
    return streetLine(detail?.full_payload?.["UnparsedAddress"]);
  } catch {
    return null;
  }
}

/** What a free account gives. Kept to three lines so the form stays above the fold. */
const BENEFITS = [
  "Sold prices and full sale history",
  "Value estimates and sold comparables",
  "Nightly alerts for the areas you follow",
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next, email } = await searchParams;
  // Open-redirect guard: only honor relative, single-slash paths (e.g. "/properties/X").
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  // Pre-fill from the apply funnel: only honor a plausibly-shaped address and cap length.
  const initialEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254
      ? email
      : "";
  // Name what the visitor came for. `next` is the raw param here, not safeNext — the
  // "/dashboard" default would otherwise read as a destination.
  const gate = loginGateFromNext(next);
  const copy = loginCopy(gate, await placeFor(gate));

  return (
    <div className="relative min-h-app overflow-hidden bg-background text-foreground">
      {/* CSS-only background (no Mapbox/deck.gl on the auth page): grid + emerald wash + scrim */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background">
        <div className="grid-pattern absolute inset-0 opacity-20" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 50% at 50% 0%, rgba(16,185,129,0.10) 0%, transparent 60%)",
          }}
        />
        {/* Vignette scrim — dark mode only. It exists to darken a dark page toward
            the edges; painted over the light ground it just greys the whole page
            out (#e9edf4 → #9fa3ad centre, #5e626f edges) and washes out the type. */}
        <div
          className="absolute inset-0 hidden dark:block"
          style={{
            background:
              "radial-gradient(115% 95% at 50% 35%, rgba(2,6,23,0.32) 0%, rgba(2,6,23,0.6) 100%)",
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-app flex-col">
        {/* Header — logo size/padding match the apply page's TopNav */}
        <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12 md:py-7">
          <Link
            href="/"
            className="flex items-center"
            aria-label="PureProperty.ca home"
          >
            {/* "auto" follows the app theme — this header sits on the page ground,
                which flips, not on a permanently-dark band. */}
            <Logo size="lg" theme="auto" />
          </Link>
          {/* Dark is now reachable only by explicit choice, and this page renders its own
              header rather than AppHeader's — so without a toggle here a signed-out visitor
              has no way back to the terminal look. Same reasoning as TopNav. */}
          <ThemeToggle className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 dark:hover:text-emerald-400 [touch-action:manipulation]" />
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10 md:px-10">
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
          <LoginViewTracker gate={gate.gate} />

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
        </main>

        <footer className="relative z-10 py-4 text-center text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} PureProperty.ca
        </footer>
      </div>
    </div>
  );
}
