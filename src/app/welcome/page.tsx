/**
 * /welcome — one-time VOW Terms acceptance gate for a signed-in user who hasn't yet
 * accepted (the dashboard server gate and requireConsumer route here when enforcement
 * is on). Bounces to /login if not signed in, or straight to `next` if already accepted.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import AcceptTermsForm from "@/components/auth/AcceptTermsForm";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNext)}`);
  if (await hasAcceptedTerms(user.id)) redirect(safeNext);

  return (
    <div className="flex min-h-app flex-col bg-background text-foreground">
      <header className="px-4 py-3">
        <Link href="/" className="inline-flex items-center" aria-label="PureProperty.ca home">
          <Logo size="md" theme="dark" />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg border border-border bg-card/40 p-6">
          <h1 className="terminal-font text-center text-sm font-bold uppercase tracking-widest text-foreground">
            VOW Access Terms
          </h1>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
            One step before you can view sold data and valuations. Confirm the following to unlock the
            terminal.
          </p>

          <div className="mt-6">
            <AcceptTermsForm next={safeNext} />
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
