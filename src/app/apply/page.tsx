"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import TopNav from "@/components/hero/TopNav";
import HeroBackground from "@/components/hero/HeroBackground";
import {
  saveProfile,
  saveConfig,
  seedConfigFromProfile,
  type ApplyProfile,
} from "@/lib/dashboard/config";

const inputClass =
  "w-full rounded-md border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-base text-slate-100 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/40";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </label>
  );
}

export default function ApplyPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const validate = (): string => {
    if (!fullName.trim()) return "Enter your full name.";
    // Strict shape: one @, a dot in domain, ≥2-char TLD (mirrors /api/viewing-requests EMAIL_RE).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid email address.";
    return "";
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setIsLoading(true);

    // Profiling was removed from signup (kept lean); the profile carries name + email
    // and empty investment fields. seedConfigFromProfile() falls back to sensible
    // defaults when these are empty, and /api/onboarding/apply stores nulls/[] fine.
    const profile: ApplyProfile = {
      fullName,
      email,
      objectives: [],
      regions: [],
      assets: [],
    };

    // Best-effort lead capture — never block access on a Supabase hiccup.
    //
    // The three VOW attestations are deliberately NOT collected here any more. They were
    // asked twice: once on this pre-account form and again on /welcome, word for word.
    // Only the /welcome set is the compliance boundary — the gate reads
    // profiles.terms_accepted_at + bona_fide_attested (lib/auth/terms.ts), which requires
    // a registered Consumer and therefore an authenticated account this form does not yet
    // have. The onboarding row's attest_* columns are write-only; nothing reads them for
    // access. So this stays lead capture, and the attestation happens once, where it binds.
    try {
      await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
    } catch (e) {
      console.warn("[apply] persist failed (granting access anyway):", e);
    }

    // Seed the dashboard locally (defaults, since profiling was skipped), then route to
    // sign-in. The dashboard shows VOW/sold data, so it requires a real account (VOW
    // compliance, §3A) — the full VOW terms attestation is enforced again at /welcome.
    saveProfile(profile);
    saveConfig(seedConfigFromProfile(profile));
    // Carry the captured email across the wall so /login can pre-fill it — no re-typing
    // at the funnel's most fragile point. Deliberately NO `next`: pinning /dashboard here
    // made every applicant look like an intentional navigation, which suppressed the
    // first-run terminal routing at /welcome. Since profiling was dropped, the seed above
    // carries NO regions — so /welcome asks for one market and opens the terminal there.
    router.push(`/login?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    // `dark` is deliberate, not leftover: this page is pinned to the terminal look in BOTH
    // themes. Now that light is the app default, without it every shadcn primitive nested
    // below (Input, Button, Select) and the TopNav wordmark — which reads the --pp-logo-*
    // CSS variables — would resolve LIGHT against this slate-950 ground. The class also
    // marks the page as an intentional island rather than one the migration missed.
    // HeroBackground additionally needs forceDark: its Mapbox style is a JS prop, and no
    // CSS class can reach that.
    <div className="dark relative min-h-app overflow-hidden bg-slate-950 text-slate-100">
      <HeroBackground variant="form" forceDark />
      <div className="relative z-10 flex min-h-app flex-col">
        <TopNav />

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-6 md:px-10 md:py-10">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-3xl font-black uppercase tracking-tight text-white md:text-6xl [text-shadow:0_4px_24px_rgba(0,0,0,0.7)]">
              Create your account
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-300 md:mt-4 [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
              {
                "Built for principals and analysts — not agents prospecting for clients. Confirm a couple of details and the terminal opens."
              }
            </p>
          </div>

          {/* Body: form + rail */}
          <div className="mt-8 grid gap-8 md:mt-10 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 backdrop-blur-md p-5 md:p-8">
              {error && (
                <div className="mb-6 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Full name</FieldLabel>
                    <input
                      className={inputClass}
                      type="text"
                      autoComplete="name"
                      placeholder="Jane Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <input
                      className={inputClass}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      enterKeyHint="done"
                      placeholder="you@firm.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-4 border-t border-slate-800 pt-6">
                  {/* The VOW attestations used to sit here as well as on /welcome, asking
                      the same three things twice. They live on /welcome only — that is
                      where they bind, against a real account. */}
                  <p className="text-xs leading-snug text-slate-500">
                    Next you&rsquo;ll confirm the VOW access terms, then the terminal opens. Read our{" "}
                    <Link href="/terms" className="text-cyan-400 hover:underline">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-cyan-400 hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </p>
                </div>
              </div>

              {/* Submit */}
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="glow-emerald inline-flex items-center gap-2 rounded-md bg-emerald-500 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Submitting
                    </>
                  ) : (
                    "Get access"
                  )}
                </button>
              </div>
            </div>

            {/* Right rail */}
            <aside className="hidden lg:block">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 backdrop-blur-md p-5">
                <p className="terminal-font text-[10px] uppercase tracking-[0.2em] text-emerald-400/80">
                  Access protocol
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {
                    "Built for principals and analysts, not agents prospecting for clients."
                  }
                </p>
                <div className="my-4 h-px bg-slate-800" />
                <p className="text-xs leading-relaxed text-slate-500">
                  {
                    "You're in as soon as you confirm your email — no waiting, no gatekeeping."
                  }
                </p>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
