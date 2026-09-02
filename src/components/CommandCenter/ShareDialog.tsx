/**
 * ShareDialog — turns a listing selection into a link the user can send.
 *
 * Two modes:
 *  - Multi-select (terminal compare panel): persists the chosen ListingKeys via
 *    POST /api/share and shares the resulting /share/<token> page.
 *  - Single listing (`shareUrl` given): shares that exact URL — the listing's own
 *    canonical page — so the recipient lands on the full listing, not a card grid.
 *
 * Either way we surface no-cost, client-only ways to send the link: copy, native
 * share sheet, SMS app, and email. We share a LINK (never raw listing data) to
 * stay TRREB-compliant — the recipient views listings inside our own UI.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Loader2, Mail, MessageSquare, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingKeys: string[];
  /**
   * Share this exact URL instead of minting a /share/<token> link. Single-listing
   * surfaces pass the listing's canonical page URL.
   */
  shareUrl?: string;
  /** Native share-sheet title + email subject. Defaults to the multi-select title. */
  title?: string;
  /** Sentence before the link in the SMS/email/share-sheet text. */
  summary?: string;
  /** Dialog heading. Defaults to "Share N properties". */
  heading?: string;
}

const SHARE_TITLE = "Properties on PureProperty";

export default function ShareDialog({
  open,
  onOpenChange,
  listingKeys,
  shareUrl,
  title,
  summary,
  heading,
}: ShareDialogProps) {
  const [loading, setLoading] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Mint the share link once per open. Re-runs if the selection changes while open.
  // A fixed shareUrl needs no round-trip — it IS the link, so the effect stays idle.
  useEffect(() => {
    if (!open || shareUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMinted(null);
    setCopied(false);

    (async () => {
      try {
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingKeys }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not create share link");
        if (!cancelled) setMinted(data.url as string);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not create share link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, listingKeys, shareUrl]);

  const url = shareUrl ?? minted;
  const shareTitle = title ?? SHARE_TITLE;
  const lead = summary ?? `${listingKeys.length} properties on PureProperty`;
  const message = url ? `${lead}: ${url}` : "";
  const dialogHeading =
    heading ?? `Share ${listingKeys.length} ${listingKeys.length === 1 ? "property" : "properties"}`;
  const dialogDescription = shareUrl
    ? "Anyone with the link can view this listing."
    : "Anyone with the link can view this selection.";

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can still select the text manually */
    }
  }, [url]);

  const handleNativeShare = useCallback(async () => {
    if (!url) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, text: message, url });
      } catch {
        /* user dismissed the share sheet — no-op */
      }
    } else {
      // No native share sheet (most desktops) — fall back to copying the link.
      handleCopy();
    }
  }, [url, shareTitle, message, handleCopy]);

  const smsHref = url ? `sms:?&body=${encodeURIComponent(message)}` : undefined;
  const emailHref = url
    ? `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(message)}`
    : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {dialogHeading}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {dialogDescription}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-700 dark:text-emerald-400" />
              Creating link...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : url ? (
            <>
              {/* Link + copy */}
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                    copied
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
                  )}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              {/* Send via the recipient's own apps (no provider cost) */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <a
                  href={smsHref}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <MessageSquare className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  Text it
                </a>
                <a
                  href={emailHref}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Mail className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  Email
                </a>
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Share2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  Share
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
