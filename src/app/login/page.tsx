import Link from "next/link";
import Logo from "@/components/Logo";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SocialAuthButtons from "@/components/auth/SocialAuthButtons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export const metadata = {
  title: "Sign in · PureProperty.ca",
};

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
        {/* Depth scrim — DARK ONLY. On the light Daylight ground this navy wash muddied
            the whole page to a murky grey, so it's gated to dark where it belongs. */}
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
            <Logo size="lg" theme="auto" />
          </Link>
          {/* Same reasoning as TopNav: /login has its own header rather than AppHeader's,
              so without this a signed-out visitor is stuck on whatever the default is. */}
          <ThemeToggle className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 dark:hover:text-emerald-400 [touch-action:manipulation]" />
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10 md:px-10">
          {/* Title — scale matches the apply page hero heading */}
          <div className="text-center">
            <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900 dark:text-white md:text-6xl dark:[text-shadow:0_4px_24px_rgba(0,0,0,0.7)]">
              Sign in
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-foreground dark:[text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
              Sign in to sync your watchlist across devices and receive market alerts.
            </p>
          </div>

          {/* Card — translucent + blur to match the apply page form card */}
          <div className="mx-auto mt-10 w-full max-w-md rounded-xl border border-border bg-card p-6 backdrop-blur-md dark:bg-card/70 md:p-8">
            <div className="mb-5">
              <SocialAuthButtons next={safeNext} />
            </div>
            <MagicLinkForm next={safeNext} initialEmail={initialEmail} />

            <p className="mt-6 text-center text-sm text-muted-foreground">
              New here? Enter your email above — first sign-in creates your account.{" "}
              {/* cyan-400 was tuned for the dark card; on the light card it measures
                  1.70:1, well under the 4.5:1 AA floor. cyan-700 is 5.17:1 in light and
                  dark keeps the original shade, so the dark page is unchanged. */}
              <Link href="/apply" className="text-cyan-700 underline dark:text-cyan-400">
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
                <Link href="/terms" className="text-cyan-700 hover:underline dark:text-cyan-400">
                  Terms of Use
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-cyan-700 hover:underline dark:text-cyan-400">
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
