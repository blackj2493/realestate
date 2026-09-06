import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "You're offline | PureProperty",
  robots: { index: false, follow: false },
};

/**
 * Served by public/sw.js when a page load fails with no network. The ONLY HTML the
 * worker ever caches, so it must carry nothing gated or perishable — no listing data,
 * no prices. Static and JS-free on purpose (a plain <a>, not a button) so it renders
 * from the cache even if its own chunks never made it in.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-app flex-col items-center justify-center px-6 py-12 text-center">
      <WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-6 text-2xl font-bold text-foreground">You&apos;re offline</h1>
      <p className="mt-3 max-w-sm text-base leading-relaxed text-muted-foreground">
        PureProperty needs a connection to load listings. Prices and status change every
        day, so nothing here is shown from an old copy.
      </p>
      <a
        href="/dashboard"
        className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 [touch-action:manipulation]"
      >
        Try again
      </a>
    </main>
  );
}
