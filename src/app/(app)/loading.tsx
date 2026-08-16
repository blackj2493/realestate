/**
 * Route-group loading state — shows instantly on client-side navigation to any
 * (app) page (dashboard, address profiles, analytics, listing pages, hubs…)
 * while the force-dynamic server render is in flight. Before this, heavy pages
 * showed NOTHING during the transition.
 */
import PulseLoader from "@/components/ui/PulseLoader";

export default function Loading() {
  return (
    <div className="flex min-h-app items-center justify-center bg-background">
      <PulseLoader size="lg" label="Reading the market" />
    </div>
  );
}
