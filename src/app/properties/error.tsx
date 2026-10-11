"use client";

/**
 * Error screen for the terminal (/properties).
 *
 * Without this file a client-side crash anywhere in the terminal fell through to Next's
 * generic "This page couldn't load", which says nothing about what failed. Client errors
 * keep their message in production, so this screen shows it: a reader's screenshot is
 * enough to find the cause. Retry re-renders the terminal without a full reload.
 */

import { useEffect } from "react";

export default function TerminalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[terminal] crashed", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-background px-4 py-10">
      <div role="alert" className="w-full max-w-md space-y-4 border border-border bg-card p-5">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
          The terminal hit an error
        </h1>
        <p className="text-sm text-muted-foreground">
          Try again, or reload the page. If it keeps happening, a screenshot of this box tells us exactly what failed.
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-[11px] text-foreground">
          {error.message || String(error)}
          {error.digest ? `\n(ref ${error.digest})` : ""}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="min-h-[44px] flex-1 bg-cyan-500 px-4 font-mono text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] flex-1 border border-border px-4 font-mono text-xs font-semibold uppercase tracking-wider text-foreground hover:border-cyan-500/50"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
