import Link from "next/link";
import Logo from "@/components/Logo";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import HeroBackground from "@/components/hero/HeroBackground";

export const metadata = {
  title: "Sign in · PureProperty.ca",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Open-redirect guard: only honor relative, single-slash paths (e.g. "/properties/X").
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Background matches the apply page (live map + legibility scrim) */}
      <HeroBackground variant="form" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header — logo size/padding match the apply page's TopNav */}
        <header className="relative z-10 flex items-center px-6 py-5 md:px-12 md:py-7">
          <Link
            href="/"
            className="flex items-center"
            aria-label="PureProperty.ca home"
          >
            <Logo size="lg" theme="dark" />
          </Link>
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10 md:px-10">
          {/* Title — scale matches the apply page hero heading */}
          <div className="text-center">
            <h1 className="text-4xl font-black uppercase tracking-tight text-white md:text-6xl [text-shadow:0_4px_24px_rgba(0,0,0,0.7)]">
              Terminal Access
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
              Sign in to sync your watchlist across devices and receive market alerts.
            </p>
          </div>

          {/* Card — translucent + blur to match the apply page form card */}
          <div className="mx-auto mt-10 w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur-md md:p-8">
            <MagicLinkForm next={safeNext} />

            <p className="mt-6 text-center text-sm text-slate-500">
              New here?{" "}
              <Link href="/apply" className="text-cyan-400 hover:underline">
                Apply for access
              </Link>{" "}
              — or just enter your email above; first sign-in creates your account.
            </p>

            {/* VOW compliance notice */}
            <div className="mt-6 rounded-md border border-slate-800 bg-slate-950/60 p-4 text-[11px] leading-relaxed text-slate-500">
              <p className="mb-1 font-medium uppercase tracking-wider text-slate-400">
                VOW Access Notice
              </p>
              <p>
                Access is restricted to consumers with a bona fide interest in the purchase,
                sale, or lease of real estate, and may not be used for any commercial purpose.
              </p>
              <p className="mt-2">
                See our{" "}
                <Link href="/terms" className="text-cyan-400 hover:underline">
                  Terms of Use
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-cyan-400 hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </main>

        <footer className="relative z-10 py-4 text-center text-[11px] text-slate-600">
          © {new Date().getFullYear()} PureProperty.ca
        </footer>
      </div>
    </div>
  );
}
