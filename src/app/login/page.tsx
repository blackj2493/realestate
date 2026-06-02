import Link from "next/link";
import Logo from "@/components/Logo";
import MagicLinkForm from "@/components/auth/MagicLinkForm";

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
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="px-4 py-3">
        <Link href="/" className="inline-flex items-center" aria-label="PureProperty.ca home">
          <Logo size="md" theme="dark" />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md border border-slate-800 bg-slate-900/40 p-6">
          <h1 className="terminal-font text-center text-sm font-bold uppercase tracking-widest text-slate-100">
            Terminal Access
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm text-slate-400">
            Sign in to sync your watchlist across devices and receive market alerts.
          </p>

          <div className="mt-6">
            <MagicLinkForm next={safeNext} />
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            New here?{" "}
            <Link href="/apply" className="text-cyan-400 hover:underline">
              Apply for access
            </Link>{" "}
            — or just enter your email above; first sign-in creates your account.
          </p>

          {/* VOW compliance notice */}
          <div className="mt-6 border border-slate-800 bg-slate-950/60 p-4 text-[11px] leading-relaxed text-slate-500">
            <p className="mb-1 font-medium uppercase tracking-wider text-slate-400">
              VOW Access Notice
            </p>
            <p>
              Access is restricted to consumers with a bona fide interest in the purchase,
              sale, or lease of real estate, and may not be used for any commercial purpose.
            </p>
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-[11px] text-slate-600">
        © {new Date().getFullYear()} PureProperty.ca
      </footer>
    </div>
  );
}
