import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * ListingComplianceNotice — the TRREB IDX consumer notice that MUST appear on
 * EVERY page displaying IDX listing data, regardless of whether any derived/AVM
 * figures are shown:
 *   • IDX Agreement §6.3(i) — information "deemed reliable but is not guaranteed
 *     accurate by PROPTX".
 *   • IDX Agreement §6.3(k) — bona-fide-consumer-use restriction (exact wording).
 *
 * This is intentionally separate from <Disclaimers/> (which also carries the
 * AVM-specific "automated estimate … not an appraisal" line and is rendered only
 * next to estimate cards). Keep this notice unconditional so a listing with no AVM
 * output still satisfies §6.3(i)/(k).
 */
export default function ListingComplianceNotice({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  // Compact single-line variant for dense surfaces (the terminal ledger footer), where the
  // bordered card is too heavy. Same §6.3(i)/(k) obligations + operator link, condensed.
  if (compact) {
    return (
      <p className={cn("text-[9px] leading-tight text-muted-foreground", className)}>
        Listing information is deemed reliable but not guaranteed accurate by PROPTX; for consumers
        with a bona fide interest only, not for any commercial purpose.{" "}
        <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">
          Operated under licence
        </Link>
        .
      </p>
    );
  }
  return (
    <div
      className={cn(
        "space-y-1 rounded-md border border-border bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <p>Listing information is deemed reliable but is not guaranteed accurate by PROPTX.</p>
      <p>
        The information provided herein must only be used by consumers that have a bona fide
        interest in the purchase, sale, or lease of real estate and may not be used for any
        commercial purpose or any other purpose.
      </p>
      <p>
        <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">
          Operated under licence
        </Link>
      </p>
    </div>
  );
}
