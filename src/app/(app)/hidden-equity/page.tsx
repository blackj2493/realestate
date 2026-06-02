import { getCurrentUser } from "@/lib/supabase/server";
import HiddenEquityTool from "@/components/hiddenEquity/HiddenEquityTool";
import MagicLinkForm from "@/components/auth/MagicLinkForm";

export const dynamic = "force-dynamic";

export default async function HiddenEquityPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-slate-200">
        <h1 className="mb-2 text-2xl font-bold">Unlock your home&apos;s Hidden Equity</h1>
        <p className="mb-6 text-sm text-slate-400">
          See your estimated value and the renovations that pay off most in your neighbourhood.
          Members only — sign in to continue.
        </p>
        <MagicLinkForm next="/hidden-equity" />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 text-slate-200">
      <h1 className="mb-1 text-2xl font-bold">Hidden Equity</h1>
      <p className="mb-6 text-sm text-slate-400">
        Your estimated value + the renovations that add the most where you are.
      </p>
      <HiddenEquityTool />
    </main>
  );
}
