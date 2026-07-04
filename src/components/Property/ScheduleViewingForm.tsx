"use client";

import { useState, useEffect, useRef } from "react";
import { CalendarDays, X } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { LEAD_INTENTS, isLeadIntent, seedMessageFor, type LeadIntent } from "./leadIntents";

// Same strict email shape used by the API route (audit LOW-18).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  listingKey: string;
  address?: string;
  /** Listing price — seeds the price-opinion message. */
  price?: number;
  /** When false, the form renders nothing while idle (a CtaLadder owns the triggers)
   *  and only appears when opened via the `pp:open-viewing` event. */
  renderTrigger?: boolean;
}

type Status = "idle" | "open" | "submitting" | "success" | "error";

export default function ScheduleViewingForm({ listingKey, address, price, renderTrigger = true }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [intent, setIntent] = useState<LeadIntent>("viewing");
  const [errorMsg, setErrorMsg] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [message, setMessage] = useState("");

  // A sticky "Contact" CTA elsewhere on the surface (the mobile action bar) opens
  // and reveals this form via a window event, keyed by listing so multiple mounted
  // forms never cross-fire. Decoupled so the form stays the sole owner of its state.
  const formRef = useRef<HTMLFormElement>(null);
  const [openSignal, setOpenSignal] = useState(0);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ listingKey?: string; intent?: string }>).detail;
      if (detail?.listingKey && detail.listingKey !== listingKey) return;
      const nextIntent: LeadIntent = isLeadIntent(detail?.intent) ? detail.intent : "viewing";
      setIntent(nextIntent);
      const seed = seedMessageFor(nextIntent, {
        priceText: price ? formatPrice(price) : undefined,
        address,
      });
      if (seed) setMessage((m) => m || seed);
      setStatus((s) => (s === "success" ? s : "open"));
      setOpenSignal((n) => n + 1);
    }
    window.addEventListener("pp:open-viewing", onOpen);
    return () => window.removeEventListener("pp:open-viewing", onOpen);
  }, [listingKey, price, address]);

  // After the form renders (open/submitting/error states), bring it into view.
  useEffect(() => {
    if (openSignal > 0) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [openSignal]);

  function open() {
    setIntent("viewing");
    setStatus("open");
  }

  function close() {
    setStatus("idle");
    setErrorMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation before hitting the API.
    if (!name.trim()) {
      setErrorMsg("Name is required.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setErrorMsg("Enter a valid email address.");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/viewing-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingKey,
          intent,
          address: address ?? "",
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          preferredTime: preferredTime.trim(),
          message: message.trim(),
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  // ── Collapsed: the same emerald CTA button (suppressed when a CtaLadder owns triggers) ──
  if (status === "idle") {
    if (!renderTrigger) return null;
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:bg-emerald-700 active:scale-95 [touch-action:manipulation]"
      >
        <CalendarDays className="h-4 w-4" />
        Schedule Viewing
      </button>
    );
  }

  // ── Success confirmation ─────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        Request sent — you&apos;ll hear back shortly.
      </div>
    );
  }

  // ── Expanded inline form (open | submitting | error) ─────────────────────────
  const isSubmitting = status === "submitting";
  const def = LEAD_INTENTS[intent];

  return (
    <form
      ref={formRef}
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{def.heading}</span>
        <button
          type="button"
          onClick={close}
          aria-label="Close schedule viewing form"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="sv-name" className="block text-xs font-medium text-muted-foreground mb-1">
          Name <span className="text-rose-700 dark:text-rose-400">*</span>
        </label>
        <input
          id="sv-name"
          type="text"
          required
          disabled={isSubmitting}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="sv-email" className="block text-xs font-medium text-muted-foreground mb-1">
          Email <span className="text-rose-700 dark:text-rose-400">*</span>
        </label>
        <input
          id="sv-email"
          type="email"
          required
          disabled={isSubmitting}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          inputMode="email"
          autoComplete="email"
          autoCorrect="off"
          enterKeyHint="next"
          className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="sv-phone" className="block text-xs font-medium text-muted-foreground mb-1">
          Phone
        </label>
        <input
          id="sv-phone"
          type="tel"
          disabled={isSubmitting}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="416-555-0100"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="next"
          className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Preferred time — viewing intent only */}
      {def.showTime && (
        <div>
          <label htmlFor="sv-time" className="block text-xs font-medium text-muted-foreground mb-1">
            Preferred time
          </label>
          <select
            id="sv-time"
            disabled={isSubmitting}
            value={preferredTime}
            onChange={(e) => setPreferredTime(e.target.value)}
            className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">Select a time…</option>
            <option value="Weekday mornings">Weekday mornings</option>
            <option value="Weekday evenings">Weekday evenings</option>
            <option value="Weekend mornings">Weekend mornings</option>
            <option value="Weekend afternoons">Weekend afternoons</option>
            <option value="ASAP / flexible">ASAP / flexible</option>
          </select>
        </div>
      )}

      {/* Message */}
      <div>
        <label htmlFor="sv-message" className="block text-xs font-medium text-muted-foreground mb-1">
          {def.messageLabel}
        </label>
        <textarea
          id="sv-message"
          disabled={isSubmitting}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={def.placeholder}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Inline error */}
      {errorMsg && (
        <p className="text-xs text-rose-700 dark:text-rose-400">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:bg-emerald-700 active:scale-95 [touch-action:manipulation] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <CalendarDays className="h-4 w-4" />
        {isSubmitting ? "Sending…" : def.submitLabel}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        We&apos;ll only use this to arrange your viewing. No spam.{" "}
        <a href="/privacy" className="underline hover:text-muted-foreground">
          Privacy policy
        </a>
        .
      </p>
    </form>
  );
}
