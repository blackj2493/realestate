"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Shown when a listing isn't in the database yet. Triggers an on-demand quick-sync
 * (same behavior as before the server-component refactor) and lets the user retry.
 * This state is marked noindex via the page's generateMetadata.
 */
async function triggerQuickSync(listingKey: string): Promise<void> {
  try {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quick-sync", listingKey, priority: "high" }),
    });
  } catch {
    /* network error — the retry button still lets the user re-check */
  }
}

export default function PropertyNotFound({ id }: { id: string }) {
  const [status, setStatus] = useState<"triggering" | "pending">("triggering");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await triggerQuickSync(id);
      if (!cancelled) setStatus("pending");
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center text-slate-200">
      <h1 className="mb-4 text-3xl font-bold">
        {status === "pending" ? "Property Syncing…" : "Loading…"}
      </h1>
      <p className="mb-8 text-slate-400">
        This listing is being synchronized from the MLS feed. It will be available shortly.
      </p>
      <div className="flex flex-col items-center gap-4">
        <div className="animate-pulse text-emerald-400">Synchronizing listing data…</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            Check Again
          </button>
          <Link
            href="/properties"
            className="rounded-md px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-slate-800"
          >
            ← Back to Command Center
          </Link>
        </div>
      </div>
    </div>
  );
}
