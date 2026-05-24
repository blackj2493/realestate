"use client";

import { useEffect } from "react";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";

/** Mounts once (root layout) to hydrate the watchlist store from server/localStorage. */
export default function WatchlistInit() {
  const init = useWatchlistStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  return null;
}
