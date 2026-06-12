"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

// Same strict email shape used by the API route (audit LOW-18).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  listingKey: string;
  address?: string;
}

type Status = "idle" | "open" | "submitting" | "success" | "error";

export default function ScheduleViewingForm({ listingKey, address }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [message, setMessage] = useState("");

  function open() {
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

  // ── Collapsed: the same emerald CTA button ──────────────────────────────────
  if (status === "idle") {
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
      >
        <CalendarDays className="h-4 w-4" />
        Schedule Viewing
      </button>
    );
  }

  // ── Success confirmation ─────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-300">
        Request sent — you&apos;ll hear back shortly.
      </div>
    );
  }

  // ── Expanded inline form (open | submitting | error) ─────────────────────────
  const isSubmitting = status === "submitting";

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-slate-700 bg-slate-900 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-200">Schedule a Viewing</span>
        <button
          type="button"
          onClick={close}
          aria-label="Close schedule viewing form"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="sv-name" className="block text-xs font-medium text-slate-400 mb-1">
          Name <span className="text-rose-400">*</span>
        </label>
        <input
          id="sv-name"
          type="text"
          required
          disabled={isSubmitting}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="sv-email" className="block text-xs font-medium text-slate-400 mb-1">
          Email <span className="text-rose-400">*</span>
        </label>
        <input
          id="sv-email"
          type="email"
          required
          disabled={isSubmitting}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="sv-phone" className="block text-xs font-medium text-slate-400 mb-1">
          Phone
        </label>
        <input
          id="sv-phone"
          type="tel"
          disabled={isSubmitting}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="416-555-0100"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Preferred time */}
      <div>
        <label htmlFor="sv-time" className="block text-xs font-medium text-slate-400 mb-1">
          Preferred time
        </label>
        <input
          id="sv-time"
          type="text"
          disabled={isSubmitting}
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
          placeholder="e.g. Weekday evenings"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Message */}
      <div>
        <label htmlFor="sv-message" className="block text-xs font-medium text-slate-400 mb-1">
          Message
        </label>
        <textarea
          id="sv-message"
          disabled={isSubmitting}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Anything specific you'd like to see?"
          rows={3}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Inline error */}
      {errorMsg && (
        <p className="text-xs text-rose-400">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <CalendarDays className="h-4 w-4" />
        {isSubmitting ? "Sending…" : "Request Viewing"}
      </button>
    </form>
  );
}
