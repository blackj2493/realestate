"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import SignInLink from "@/components/auth/SignInLink";

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

  if (!email) {
    return (
      <SignInLink className="terminal-font inline-flex shrink-0 items-center gap-1.5 border border-border px-3 py-2 text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-slate-500">
        <LogIn className="h-3.5 w-3.5" /> Sign in
      </SignInLink>
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
        className="terminal-font border border-border px-3 py-2 text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-slate-500"
      >
        Sign out
      </button>
    </form>
  );
}
