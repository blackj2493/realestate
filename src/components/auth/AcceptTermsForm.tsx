"use client";

/**
 * AcceptTermsForm — the one-time VOW Terms acceptance for a signed-in user. Posts to
 * /api/vow/accept-terms, then returns the user to where they were headed (`next`).
 * Mirrors the §3 attestations on /apply, but for an authenticated account.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function CheckRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-emerald-500 bg-emerald-500 text-slate-950" : "border-border bg-card"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="text-sm leading-snug text-foreground">{children}</span>
    </button>
  );
}

export default function AcceptTermsForm({ next }: { next: string }) {
  const router = useRouter();
  const [notAgent, setNotAgent] = useState(false);
  const [bonaFide, setBonaFide] = useState(false);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allChecked = notAgent && bonaFide && agree;

  const submit = async () => {
    if (!allChecked) {
      setError("All three confirmations are required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/vow/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Server re-verifies these — the disabled button is UX, not the security boundary.
        body: JSON.stringify({ notAgent, bonaFide, agree }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not record your acceptance. Please try again.");
      }
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <CheckRow checked={notAgent} onToggle={() => setNotAgent((v) => !v)}>
        I am a principal/investor with a bona fide interest — not a licensed agent prospecting for
        clients.
      </CheckRow>
      <CheckRow checked={bonaFide} onToggle={() => setBonaFide((v) => !v)}>
        I have a bona fide interest in the purchase, sale, or lease of real estate.
      </CheckRow>
      <CheckRow checked={agree} onToggle={() => setAgree((v) => !v)}>
        I agree to the VOW Terms of Use and will use this data for personal, non-commercial purposes
        only.
      </CheckRow>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Read our full{" "}
        <Link href="/terms" className="text-cyan-400 hover:underline">
          Terms of Use
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-cyan-400 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!allChecked || loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Unlocking
          </>
        ) : (
          "Unlock the terminal"
        )}
      </button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Data is deemed reliable but is not guaranteed accurate by PROPTX. Information herein must only
        be used by consumers with a bona fide interest in the purchase, sale, or lease of real estate
        and may not be used for any commercial purpose.
      </p>
    </div>
  );
}
