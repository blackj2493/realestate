"use client";

import { useMemo, useState } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ShareDialog from "@/components/CommandCenter/ShareDialog";

/**
 * "Share" pill for the top of the full listing page, beside the Save pill. Opens the
 * same ShareDialog the terminal's compare panel uses (copy / text / email / native
 * share sheet), but shares the listing's own canonical URL so the recipient lands on
 * the full listing rather than a /share/<token> card grid. No API call, no login.
 *
 * Below `sm` the label hides so a long address keeps room to wrap; the icon +
 * aria-label carry the meaning.
 */
export default function ShareListingButton({
  listingKey,
  address,
  url,
  className,
}: {
  listingKey: string;
  /** Display address — becomes the share-sheet title and the email subject. */
  address: string;
  /** Absolute canonical URL of this listing page. */
  url: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Stable identity: ShareDialog keys its effect on this array.
  const listingKeys = useMemo(() => [listingKey], [listingKey]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share this listing"
        title="Share this listing"
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-cyan-700 dark:hover:text-cyan-300",
          className
        )}
      >
        <Share2 style={{ width: 16, height: 16 }} />
        <span className="hidden sm:inline">Share</span>
      </button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        listingKeys={listingKeys}
        shareUrl={url}
        title={address}
        summary={`${address} on PureProperty`}
        heading="Share this listing"
      />
    </>
  );
}
