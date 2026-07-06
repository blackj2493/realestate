"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

/**
 * Header account control. Shows "Sign in" for anonymous visitors, or the user's
 * handle + "Sign out" when authenticated. Sign-out posts to /auth/signout.
 */
export default function AccountButton() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Below md the label collapses to the icon alone — part of the phone width
  // budget that keeps the header's right cluster (and the hamburger) on-screen.
  if (!email) {
    return (
      <Link
        href="/login"
        aria-label="Sign in"
        title="Sign in"
        className="terminal-font inline-flex shrink-0 items-center gap-1.5 border border-border px-2.5 py-2 text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-slate-500 md:px-3"
      >
        <LogIn className="h-3.5 w-3.5" /> <span className="hidden md:inline">Sign in</span>
      </Link>
    );
  }

  return (
    <form action="/auth/signout" method="post" className="flex shrink-0 items-center gap-2">
      <span
        className="terminal-font hidden max-w-[120px] truncate text-[11px] uppercase tracking-wider text-muted-foreground md:inline"
        title={email}
      >
        {email.split("@")[0]}
      </span>
      <button
        type="submit"
        aria-label="Sign out"
        title="Sign out"
        className="terminal-font inline-flex items-center gap-1.5 border border-border px-2.5 py-2 text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-slate-500 md:px-3"
      >
        <LogOut className="h-3.5 w-3.5 md:hidden" /> <span className="hidden md:inline">Sign out</span>
      </button>
    </form>
  );
}
