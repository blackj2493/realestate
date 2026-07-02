"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronRight, ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import TopNav from "@/components/hero/TopNav";
import HeroBackground from "@/components/hero/HeroBackground";
import {
  saveProfile,
  saveConfig,
  seedConfigFromProfile,
  type ApplyProfile,
} from "@/lib/dashboard/config";

const STEPS = [
  { n: 1, label: "Identity & Intent" },
  { n: 2, label: "Investment Criteria" },
  { n: 3, label: "VOW Terms" },
] as const;

const APPLICANT_TYPES = [
  "Individual / Principal",
  "Corporation",
  "Partnership / JV",
  "Fund",
];
const OBJECTIVES = [
  "Analyze rental yield / cap rates",
  "Source zoning & conversion upside",
  "Target distressed & off-market deals",
  "Land assembly / development",
  "Buy a home with hidden value (suite / basement potential)",
];
const REGIONS = [
  "Toronto",
  "Peel",
  "York",
  "Durham",
  "Halton",
  "Hamilton",
  "Ottawa",
  "Other",
];
const CAPITAL = ["<$500K", "$500K–$1M", "$1M–$3M", "$3M+"];
const ASSETS = [
  "Detached",
  "Condo",
  "Multiplex (2–6)",
  "Multi-residential",
  "Land",
  "Commercial",
];
const CADENCE = ["0–1", "2–4", "5–9", "10+"];

const inputClass =
  "w-full rounded-md border border-border bg-card/60 px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/40";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[44px] rounded-md border px-4 py-2 text-sm transition-colors [touch-action:manipulation] active:bg-muted",
        active
          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-card/60 text-foreground hover:border-border"
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors [touch-action:manipulation] active:bg-muted",
        active
          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-card/60 text-muted-foreground hover:border-border"
      )}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

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
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-3 text-left"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          checked
            ? "border-emerald-500 bg-emerald-500 text-slate-950"
            : "border-border bg-card"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="text-sm leading-snug text-foreground">{children}</span>
    </button>
  );
}

const toggle = (arr: string[], v: string) =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export default function ApplyPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1
  const [applicantType, setApplicantType] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [entityName, setEntityName] = useState("");
  const [objectives, setObjectives] = useState<string[]>([]);

  // Step 2
  const [regions, setRegions] = useState<string[]>([]);
  const [capital, setCapital] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const [cadence, setCadence] = useState("");

  // Step 3
  const [attestNotAgent, setAttestNotAgent] = useState(false);
  const [attestBonaFide, setAttestBonaFide] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const validateStep = (s: number): string => {
    if (s === 1) {
      if (!applicantType) return "Select your applicant type.";
      if (!fullName.trim()) return "Enter your full name.";
      // Strict shape: one @, a dot in domain, ≥2-char TLD (mirrors /api/viewing-requests EMAIL_RE).
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid email address.";
    }
    if (s === 2) {
      if (regions.length === 0) return "Select at least one target region.";
      if (!capital) return "Select your capital per deal.";
      if (assets.length === 0) return "Select at least one asset focus.";
      if (!cadence) return "Select your acquisition cadence.";
    }
    if (s === 3) {
      if (!attestNotAgent || !attestBonaFide || !agreeTerms)
        return "All three attestations are required to submit.";
    }
    return "";
  };

  const handleNext = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setStep((s) => Math.min(3, s + 1));
  };

  const handleBack = () => {
    setError("");
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    const err = validateStep(3);
    if (err) {
      setError(err);
      return;
    }
    setError("");
    setIsLoading(true);

    const profile: ApplyProfile = {
      applicantType,
      fullName,
      email,
      entityName,
      objectives,
      regions,
      capital,
      assets,
      cadence,
    };

    // Best-effort lead capture — never block access on a Supabase hiccup.
    try {
      await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          attestNotAgent,
          attestBonaFide,
          agreeTerms,
        }),
      });
    } catch (e) {
      console.warn("[apply] persist failed (granting access anyway):", e);
    }

    // Seed the personalized dashboard locally, then route to sign-in. The dashboard
    // shows VOW/sold data, so it requires a real account (VOW compliance, §3A). The
    // saved profile/config personalize it once they sign in on this device.
    saveProfile(profile);
    saveConfig(seedConfigFromProfile(profile));
    // Carry the captured email across the wall so /login can pre-fill it —
    // no re-typing at the funnel's most fragile point.
    router.push(`/login?next=/dashboard&email=${encodeURIComponent(email.trim())}`);
  };

  const currentLabel = STEPS[step - 1].label;

  return (
    <div className="relative min-h-app overflow-hidden bg-background text-foreground">
      <HeroBackground variant="form" />
      <div className="relative z-10 flex min-h-app flex-col">
        <TopNav />

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-6 md:px-10 md:py-10">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-3xl font-black uppercase tracking-tight text-white md:text-6xl [text-shadow:0_4px_24px_rgba(0,0,0,0.7)]">
              Terminal Access Application
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-foreground md:mt-4 [text-shadow:0_2px_12px_rgba(0,0,0,0.85)]">
              {
                "Built for principals and analysts — not agents prospecting for clients. Tell us how you invest and the terminal opens to the right tools."
              }
            </p>
          </div>

          {/* Stepper — desktop */}
          <div className="mt-10 hidden items-center justify-center gap-2 md:flex">
            {STEPS.map((s, i) => {
              const active = step === s.n;
              const done = step > s.n;
              return (
                <Fragment key={s.n}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold",
                        active
                          ? "border-emerald-500 bg-emerald-500 text-slate-950"
                          : done
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                          : "border-border bg-card text-muted-foreground"
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : s.n}
                    </span>
                    <span
                      className={cn(
                        "terminal-font text-[11px] uppercase tracking-[0.15em]",
                        active
                          ? "text-emerald-300"
                          : done
                          ? "text-muted-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      Step {s.n} · {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* Stepper — mobile */}
          <div className="mt-6 md:hidden">
            <p className="terminal-font text-center text-[11px] uppercase tracking-[0.2em] text-emerald-300">
              Step {step} of 3 · {currentLabel}
            </p>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
          </div>

          {/* Body: form + rail */}
          <div className="mt-6 grid gap-8 md:mt-10 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="rounded-xl border border-border bg-card/70 backdrop-blur-md p-5 md:p-8">
              {error && (
                <div className="mb-6 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {error}
                </div>
              )}

              {step === 1 && (
                <div className="space-y-7">
                  <div>
                    <FieldLabel>Applicant type</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {APPLICANT_TYPES.map((t) => (
                        <Pill
                          key={t}
                          active={applicantType === t}
                          onClick={() => setApplicantType(t)}
                        >
                          {t}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <FieldLabel>Full name</FieldLabel>
                      <input
                        className={inputClass}
                        type="text"
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
                        enterKeyHint="next"
                        placeholder="you@firm.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Entity name (if applicable)</FieldLabel>
                    <input
                      className={inputClass}
                      type="text"
                      placeholder="Legal entity name"
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                    />
                  </div>

                  <div>
                    <FieldLabel>Primary investment objective</FieldLabel>
                    <div className="space-y-3">
                      {OBJECTIVES.map((o) => (
                        <CheckRow
                          key={o}
                          checked={objectives.includes(o)}
                          onToggle={() => setObjectives((a) => toggle(a, o))}
                        >
                          {o}
                        </CheckRow>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-7">
                  <div>
                    <FieldLabel>Target regions</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {REGIONS.map((r) => (
                        <Chip
                          key={r}
                          active={regions.includes(r)}
                          onClick={() => setRegions((a) => toggle(a, r))}
                        >
                          {r}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Capital per deal</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {CAPITAL.map((c) => (
                        <Pill
                          key={c}
                          active={capital === c}
                          onClick={() => setCapital(c)}
                        >
                          {c}
                        </Pill>
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Asset focus</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {ASSETS.map((a) => (
                        <Chip
                          key={a}
                          active={assets.includes(a)}
                          onClick={() => setAssets((arr) => toggle(arr, a))}
                        >
                          {a}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Acquisitions next 12 months</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {CADENCE.map((c) => (
                        <Pill
                          key={c}
                          active={cadence === c}
                          onClick={() => setCadence(c)}
                        >
                          {c}
                        </Pill>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <CheckRow
                    checked={attestNotAgent}
                    onToggle={() => setAttestNotAgent((v) => !v)}
                  >
                    {
                      "I am applying as a principal/investor deploying my own capital — not as a licensed agent prospecting for clients."
                    }
                  </CheckRow>
                  <CheckRow
                    checked={attestBonaFide}
                    onToggle={() => setAttestBonaFide((v) => !v)}
                  >
                    {
                      "I certify that I have a bona fide interest in the purchase, sale, or lease of real estate."
                    }
                  </CheckRow>
                  <CheckRow
                    checked={agreeTerms}
                    onToggle={() => setAgreeTerms((v) => !v)}
                  >
                    {"I agree to the Terms of Service and Privacy Policy."}
                  </CheckRow>
                  <p className="text-xs leading-snug text-muted-foreground">
                    Read our{" "}
                    <Link href="/terms" className="text-cyan-400 hover:underline">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="text-cyan-400 hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </p>
                  <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                    {
                      "This does not constitute a consumer service agreement. VOW compliance is verified before access is granted."
                    }
                  </p>
                </div>
              )}

              {/* Nav buttons */}
              <div className="mt-8 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={step === 1}
                  className={cn(
                    "inline-flex min-h-[44px] items-center gap-2 rounded-md px-4 py-2.5 text-sm transition-colors [touch-action:manipulation]",
                    step === 1
                      ? "cursor-not-allowed text-muted-foreground"
                      : "text-muted-foreground hover:text-foreground active:text-foreground"
                  )}
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="glow-emerald inline-flex items-center gap-2 rounded-md bg-emerald-500 px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-950 transition-colors hover:bg-emerald-400"
                  >
                    Next step <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
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
                      "Submit application"
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Right rail */}
            <aside className="hidden lg:block">
              <div className="rounded-xl border border-border bg-card/70 backdrop-blur-md p-5">
                <p className="terminal-font text-[10px] uppercase tracking-[0.2em] text-emerald-400/80">
                  Access protocol
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {
                    "Built for principals and analysts, not agents prospecting for clients. We ask how you invest so the terminal opens to the tools that fit you."
                  }
                </p>
                <div className="my-4 h-px bg-muted" />
                <p className="text-xs leading-relaxed text-muted-foreground">
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
