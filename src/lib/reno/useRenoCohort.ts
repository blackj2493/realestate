'use client';

import { useEffect, useState } from 'react';
import type { RenoCohort } from './cohort';

/**
 * Fetches the beds × type cohort ("homes like yours") for the renovation result once
 * coordinates, type and bedroom count are known. Result is keyed by its own scope, so a
 * response for a previous home can never paint against the current one — and no reset
 * setState is needed inside the effect.
 *
 * Returns `{ cohort, settled }`; `settled` distinguishes "still loading" from
 * "asked, and there is nothing to show" so callers don't spin forever.
 */
export function useRenoCohort(
  lat: number | null | undefined,
  lng: number | null | undefined,
  type: string,
  beds: number,
): { cohort: RenoCohort | null; settled: boolean } {
  const key = `${lat ?? ''}|${lng ?? ''}|${type}|${beds}`;
  const [loaded, setLoaded] = useState<{ key: string; data: RenoCohort | null } | null>(null);

  useEffect(() => {
    if (lat == null || lng == null || !type) return;
    let cancelled = false;
    const scope = `${lat}|${lng}|${type}|${beds}`;
    const qs = new URLSearchParams({ lat: String(lat), lng: String(lng), type, beds: String(beds) });
    fetch(`/api/reno/cohort?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setLoaded({ key: scope, data: (j as RenoCohort) ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: scope, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, type, beds]);

  const settled = loaded?.key === key;
  return { cohort: settled ? loaded!.data : null, settled };
}
