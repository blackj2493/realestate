import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import HiddenEquityTool from "@/components/hiddenEquity/HiddenEquityTool";
import MagicLinkForm from "@/components/auth/MagicLinkForm";

export const dynamic = "force-dynamic";

/**
 * Validate an internal redirect target. Accepts only same-origin absolute paths
 * ("/foo") and rejects protocol-relative ("//evil.com"), backslash tricks
 * ("/\\evil.com"), and anything not starting with a single "/". Falls back to
 * the Hidden Equity page itself so the gate never forwards anything unsafe.
 */
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return "/hidden-equity";
  if (!v.startsWith("/")) return "/hidden-equity";
  if (v.startsWith("//") || v.startsWith("/\\")) return "/hidden-equity";
  return v;
}

export default async function HiddenEquityPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNext(rawNext);

  const user = await getCurrentUser();
  if (!user) {
    // When a cold /avm visitor is redirected here (/hidden-equity?next=/avm),
    // frame the gate around the AVM (estimated value) outcome instead of equity.
    const isAvm = next === "/avm";
    const heading = isAvm
      ? "Get your home's estimated value — free"
      : "What's your home really worth?";
    const benefits = isAvm
      ? [
          "An instant, data-backed estimate of your home's value",
          "The price range comps actually support in your neighbourhood",
          "Updated nightly from sold-price data — no agent call required",
        ]
      : [
          "Your home's estimated market value, instantly",
          "The renovations that pay back most where you live",
          "Built on real neighbourhood sold-price data — not a guess",
        ];

    return (
      <main className="mx-auto max-w-md px-4 pb-safe pt-[max(env(safe-area-inset-top),4rem)] text-foreground">
        <h1 className="mb-2 text-2xl font-bold">{heading}</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {isAvm
            ? "A free, neighbourhood-calibrated valuation. Sign in to see your number."
            : "See your estimated value and the renovation moves that add the most equity nearby. Sign in to unlock your report."}
        </p>

        {/* Value-prop: make the payoff clear BEFORE asking for an email. */}
        <ul className="mb-6 space-y-2">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-foreground">
              <span aria-hidden="true" className="mt-0.5 text-emerald-700 dark:text-emerald-400">
                ✓
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <MagicLinkForm next={next} />

        <p className="mt-6 text-xs text-muted-foreground">
          Just curious what a renovation could add?{" "}
          <Link
            href="/whats-my-home-hiding"
            className="text-cyan-700 dark:text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
          >
            See your home&apos;s renovation upside — no sign-in →
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-safe py-8 text-foreground">
      <h1 className="mb-1 text-2xl font-bold">Hidden Equity</h1>
      <p className="mb-2 text-sm text-muted-foreground">
        Your estimated value + the renovations that add the most where you are.
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        Curious about a single renovation?{" "}
        <Link
          href="/whats-my-home-hiding"
          className="text-cyan-700 dark:text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
        >
          Compare renovation payback →
        </Link>
      </p>
      <HiddenEquityTool />
    </main>
  );
}
