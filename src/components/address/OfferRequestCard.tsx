"use client";

/**
 * OfferRequestCard — a free, written offer on an address page that a visitor can request
 * with name + email (phone optional). Shared by the selling-plan card (homeowners) and the
 * home-report card (anyone weighing this home). One form, one pipeline: requests go
 * through /api/viewing-requests with the card's intent and the home's ADDRESS (no listing
 * key), so they land in the same lead flow and get the same instant acknowledgement.
 *
 * Wording rules (owner, 2026-11-03): no personal or brokerage name, and no "REALTOR" or
 * "MLS" on the report card. No valuation is rendered here — any "what it is worth" is a
 * written opinion sent later by a person, never an automated figure on the page.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { track } from "@/lib/analytics/posthog";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Status = "idle" | "open" | "sending" | "sent" | "error";

export type OfferIntent = "selling_plan" | "home_report" | "new_vs_resale";

export interface OfferCopy {
  title: string;
  intro: string;
  points: string[];
  footnote: string;
  openLabel: string;
  sentText: (address: string, email: string) => string;
  messagePlaceholder: string;
}

export default function OfferRequestCard({
  address,
  intent,
  copy,
  askAddress,
}: {
  address: string;
  intent: OfferIntent;
  copy: OfferCopy;
  /** No fixed home (e.g. /new-homes-hst): the form asks the reader what they are comparing. */
  askAddress?: { label: string; placeholder: string };
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [where, setWhere] = useState(address);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const id = intent.replace(/_/g, "-");

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
    if (!where.trim()) return setError(askAddress ? `${askAddress.label} is required.` : "Address is required.");
    setError("");
    setStatus("sending");
    try {
      const res = await fetch("/api/viewing-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent,
          address: where.trim(),
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          message: message.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Something went wrong. Please try again.");
      track("address_offer_requested", { intent, hasPhone: phone.trim().length > 0 });
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  const input =
    "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:outline-none disabled:opacity-50";

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-5">
      <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">
        {copy.title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{copy.intro}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
        {copy.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">{copy.footnote}</p>

      {status === "sent" ? (
        <p className="mt-4 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {copy.sentText(where, email)}
        </p>
      ) : status === "idle" ? (
        <button
          type="button"
          onClick={() => {
            setStatus("open");
            track("address_offer_opened", { intent });
          }}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          {copy.openLabel}
        </button>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-name`} className="mb-1 block text-xs font-medium text-muted-foreground">
                Name
              </label>
              <input id={`${id}-name`} className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={status === "sending"} />
            </div>
            <div>
              <label htmlFor={`${id}-email`} className="mb-1 block text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input id={`${id}-email`} type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={status === "sending"} />
            </div>
          </div>
          {askAddress && (
            <div>
              <label htmlFor={`${id}-where`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {askAddress.label}
              </label>
              <input id={`${id}-where`} className={input} value={where} onChange={(e) => setWhere(e.target.value)} placeholder={askAddress.placeholder} maxLength={300} disabled={status === "sending"} />
            </div>
          )}
          <div>
            <label htmlFor={`${id}-phone`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Phone (optional)
            </label>
            <input id={`${id}-phone`} type="tel" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" disabled={status === "sending"} />
          </div>
          <div>
            <label htmlFor={`${id}-msg`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Anything we should know? (optional)
            </label>
            <textarea
              id={`${id}-msg`}
              rows={2}
              className={`${input} resize-none`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={copy.messagePlaceholder}
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
            We use this only to answer your request. <a href="/privacy" className="underline">Privacy policy</a>.
          </p>
        </form>
      )}
    </section>
  );
}
