"use client";

/**
 * SellingPlanCard — the seller offer on the /address page (2026-11).
 *
 * WHY HERE. A homeowner on their own address page is already looking at prices: the
 * "If listed today" band sits right above this card, and the street ledger beside it.
 * That is the moment help is welcome. The same offer at signup read as a sales funnel,
 * so it lives here instead (owner decision 2026-11-03).
 *
 * WORDING. Generic "a licensed REALTOR®" — no personal or brokerage name on the card
 * (owner decision). The plan promises four things the site's own data answers: real sold
 * prices on the street, true time to sell (relists counted), which upgrades pay, and timing
 * plus today's competition. No valuation is shown here: "If listed today" is an ASKING
 * range on purpose (AVM licensing), and this card does not change that.
 *
 * Requests go through /api/viewing-requests with intent `selling_plan` (no listing key —
 * the home is identified by its address), so they land in the same lead pipeline and get
 * the same instant acknowledgement as every other lead.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { track } from "@/lib/analytics/posthog";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Status = "idle" | "open" | "sending" | "sent" | "error";

export default function SellingPlanCard({ address }: { address: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // A signed-in member is not a stranger: prefill what we know, never overwrite typing.
  useEffect(() => {
    if (status !== "open") return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled || !data.user) return;
        const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
        const full = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : "";
        if (data.user.email) setEmail((v) => v || data.user!.email!);
        if (full) setName((v) => v || full);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    setError("");
    setStatus("sending");
    try {
      const res = await fetch("/api/viewing-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "selling_plan",
          address,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          message: message.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Something went wrong. Please try again.");
      track("selling_plan_requested", { hasPhone: phone.trim().length > 0 });
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  const input =
    "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none disabled:opacity-50";

  return (
    <section
      aria-labelledby="selling-plan-title"
      className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5"
    >
      <h2 id="selling-plan-title" className="text-base font-semibold text-foreground">
        Thinking of selling? Get a selling plan for your home.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A licensed REALTOR&reg; prepares it from your street&rsquo;s real sales:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
        <li>the price to list at, and what similar homes actually sold for</li>
        <li>how long homes like yours really take to sell, counting relists</li>
        <li>which upgrades are worth doing before you list, and which are not</li>
        <li>when to list, and which homes you will compete with today</li>
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">Free. No calls unless you ask for one.</p>

      {status === "sent" ? (
        <p className="mt-4 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Request sent. Your selling plan for {address} is on its way to {email}.
        </p>
      ) : status === "idle" ? (
        <button
          type="button"
          onClick={() => {
            setStatus("open");
            track("selling_plan_opened", {});
          }}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          Get my selling plan
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sp-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                Name
              </label>
              <input id="sp-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={status === "sending"} />
            </div>
            <div>
              <label htmlFor="sp-email" className="mb-1 block text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input id="sp-email" type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={status === "sending"} />
            </div>
          </div>
          <div>
            <label htmlFor="sp-phone" className="mb-1 block text-xs font-medium text-muted-foreground">
              Phone (optional)
            </label>
            <input id="sp-phone" type="tel" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" disabled={status === "sending"} />
          </div>
          <div>
            <label htmlFor="sp-msg" className="mb-1 block text-xs font-medium text-muted-foreground">
              Anything we should know? (optional)
            </label>
            <textarea
              id="sp-msg"
              rows={2}
              className={`${input} resize-none`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. finished basement, new roof in 2023, hoping to list in spring"
              disabled={status === "sending"}
            />
          </div>
          {error && <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {status === "sending" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending
              </>
            ) : (
              "Send my request"
            )}
          </button>
          <p className="text-[11px] text-muted-foreground">
            We use this only to send your plan. <a href="/privacy" className="underline">Privacy policy</a>.
          </p>
        </form>
      )}
    </section>
  );
}
