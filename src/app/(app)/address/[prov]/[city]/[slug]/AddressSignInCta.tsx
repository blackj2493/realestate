"use client";

/**
 * The anonymous sign-in CTA on the address page. Two jobs beyond the link:
 *   1. Capture the area being viewed into localStorage so the welcome email
 *      (sent after sign-in) can lead with it. Consumed by <WelcomeOnSignup>.
 *   2. Pass `next` so sign-in returns the visitor to THIS property, instead of
 *      dumping them on /dashboard (the old CTA had no next → a funnel leak).
 */

import { useEffect } from "react";
import Link from "next/link";

export interface AddressIntent {
  label: string;
  slug: string;
  prov?: string;
}

export default function AddressSignInCta({ intent, next }: { intent: AddressIntent; next: string }) {
  useEffect(() => {
    try {
      localStorage.setItem("pp_signup_intent", JSON.stringify(intent));
    } catch {
      /* private mode / storage disabled — welcome just falls back to generic */
    }
  }, [intent]);

  return (
    <Link
      href={`/login?next=${encodeURIComponent(next)}`}
      className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-emerald-500 px-6 text-sm font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
    >
      Sign in to see sale history
    </Link>
  );
}
