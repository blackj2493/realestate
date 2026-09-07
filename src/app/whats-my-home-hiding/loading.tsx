/**
 * Loading state for /whats-my-home-hiding.
 *
 * This route lives OUTSIDE the (app) group, so it never inherited (app)/loading.tsx — and
 * it is `force-dynamic`, so a click on "Reno Upside" left the browser sitting on the
 * PREVIOUS page with no feedback at all until the server render returned. When the cohort
 * tree had to be rebuilt that was 16–19 seconds of a page that looked simply broken.
 *
 * Migration 140 and the shared Data Cache took the common case down to well under a second,
 * but a cold rebuild still has to happen to somebody. Whoever draws that turn should see the
 * app respond to their click.
 *
 * Same loader as (app)/loading.tsx so the two feel like one product.
 */
import PulseLoader from "@/components/ui/PulseLoader";

export default function Loading() {
  return (
    <div className="flex min-h-app items-center justify-center bg-background">
      <PulseLoader size="lg" label="Reading your neighbourhood" />
    </div>
  );
}
