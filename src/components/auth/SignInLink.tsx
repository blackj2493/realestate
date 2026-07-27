"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { loginHref } from "@/lib/auth/loginHref";

/**
 * A sign-in link that returns the visitor to the page they were on.
 *
 * Every locked card, blurred number and "unlock this home" button should use this rather
 * than linking to `/login` directly. Reading the destination from `usePathname()` instead
 * of a prop means a gated CTA cannot be added without a return path — the failure mode
 * that sent listing-page signups to the map (see loginHref).
 *
 * Safe inside Server Components: `usePathname()` resolves during SSR too, so the emitted
 * HTML already carries the right href and there is no post-hydration flicker.
 */
export default function SignInLink({
  children,
  className,
  next,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Override the destination. Only needed when the current URL alone doesn't identify
   * what the user is looking at — the compare shortlist, whose state lives in `?ids=`,
   * is the one real case. `usePathname()` drops query strings by design.
   */
  next?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  const pathname = usePathname();
  return (
    <Link href={loginHref(next ?? pathname)} className={className} {...rest}>
      {children}
    </Link>
  );
}
