/**
 * Map-terminal loading state — shows instantly on navigation to /properties
 * while the client bundle + first query spin up.
 */
import PulseLoader from "@/components/ui/PulseLoader";

export default function Loading() {
  return (
    <div className="flex min-h-app items-center justify-center bg-background">
      <PulseLoader size="lg" label="Booting the terminal" />
    </div>
  );
}
