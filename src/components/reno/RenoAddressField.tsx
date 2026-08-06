'use client';

/**
 * Address-first entry for the renovation-upside tool.
 *
 * The cohort tree is geography-LESS — `cityRegion` is the raw MLS community string,
 * not computable from a geocode by rule (see loadCohortTree). So we resolve an
 * address to a trained cohort by asking /api/reno/resolve-area, which votes on the
 * MLS community across the nearest SOLD records (dense, per-house) plus active
 * listings — then match that community into the tree. Best-effort *pre-fill* the
 * user can override with the neighbourhood picker.
 *
 * VOW: the resolver returns only a community NAME (public taxonomy) — never a
 * price, address, date, or count — so no VOW Listing Information is disclosed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeCityRegion, type CohortTree } from '@/lib/avm/cohorts';
import type { GeocodeResult } from '@/app/api/geocode/route';

export interface ResolvedLocation {
  /** Tree city key (empty when we couldn't place it in the tree). */
  city: string;
  /** Raw cohort city_region key (empty when unmatched — user picks below). */
  cityRegion: string;
  /** True when we mapped the address to a trained cohort. */
  matched: boolean;
  /** The geocoded address label the user selected. */
  label: string;
  /** Geocoded coordinates — power the point-based nearby carousels. */
  lat: number | null;
  lng: number | null;
}

/**
 * Match a nearest listing's (City, CityRegion) to a trained cohort. Matches on the
 * community (CityRegion) across the whole tree — it's more specific than City and
 * immune to the Toronto/Ottawa City-field taxonomy quirks (City:=Toronto matches
 * nothing). Prefers a cohort whose city also matches when a community name repeats.
 */
function matchCohort(
  tree: CohortTree,
  listingCity: string | undefined,
  listingCityRegion: string | undefined,
): { city: string; cityRegion: string } | null {
  if (!listingCityRegion) return null;
  const target = normalizeCityRegion(listingCityRegion).trim().toLowerCase();
  if (!target) return null;
  const lc = (listingCity ?? '').trim().toLowerCase();
  let fallback: { city: string; cityRegion: string } | null = null;
  for (const [city, comms] of Object.entries(tree)) {
    for (const c of comms) {
      if (normalizeCityRegion(c.cityRegion).trim().toLowerCase() === target) {
        if (city.toLowerCase() === lc) return { city, cityRegion: c.cityRegion };
        fallback ??= { city, cityRegion: c.cityRegion };
      }
    }
  }
  return fallback;
}

/**
 * Resolve a point to its MLS community via the server resolver, which votes across
 * nearby SOLD records (dense, per-house) plus active listings. Sold density fixes
 * the sparse-inventory boundary errors the old active-only, single-nearest match
 * produced (an NW-Brampton home landing in Fletcher's Meadow).
 */
async function resolveArea(
  lat: number,
  lng: number,
): Promise<{ city?: string; cityRegion?: string } | null> {
  try {
    const res = await fetch(`/api/reno/resolve-area?lat=${lat}&lng=${lng}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { cityRegion?: string | null; city?: string | null };
    if (!d.cityRegion) return null;
    return { city: d.city ?? undefined, cityRegion: d.cityRegion };
  } catch {
    return null;
  }
}

type Status =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'matched'; label: string; community: string; city: string }
  | { kind: 'nomatch'; label: string };

export default function RenoAddressField({
  tree,
  onResolve,
}: {
  tree: CohortTree;
  onResolve: (r: ResolvedLocation) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSuggest = query.trim().length >= 3;

  // Debounced Mapbox geocode (via the shared /api/geocode route, 30/min/IP).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      // Cancel any pending/in-flight lookup; the dropdown render is gated on
      // `canSuggest`, so no synchronous setState is needed to hide stale results.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { results?: GeocodeResult[] };
        setSuggestions(data.results ?? []);
      } catch {
        /* aborted or offline — leave prior suggestions */
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const pick = useCallback(
    async (hit: GeocodeResult) => {
      setQuery(hit.label);
      setOpen(false);
      setSuggestions([]);
      setStatus({ kind: 'resolving' });

      const area = await resolveArea(hit.lat, hit.lng);
      const match = matchCohort(tree, area?.city, area?.cityRegion);

      if (match) {
        const community = normalizeCityRegion(match.cityRegion);
        setStatus({ kind: 'matched', label: hit.label, community, city: match.city });
        onResolve({ ...match, matched: true, label: hit.label, lat: hit.lat, lng: hit.lng });
        return;
      }

      // Couldn't place the exact community. If the listing's city is itself a tree
      // key, scope the community dropdown to it; otherwise leave the pickers open.
      const cityKey = area?.city && tree[area.city] ? area.city : '';
      setStatus({ kind: 'nomatch', label: hit.label });
      onResolve({ city: cityKey, cityRegion: '', matched: false, label: hit.label, lat: hit.lat, lng: hit.lng });
    },
    [tree, onResolve],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground" htmlFor="reno-address-input">
        YOUR ADDRESS
      </Label>
      <div className="relative">
        <MapPin
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="reno-address-input"
          role="combobox"
          aria-expanded={open && canSuggest && suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls="reno-address-listbox"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (status.kind !== 'idle') setStatus({ kind: 'idle' });
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder="Start typing your home address…"
          className="h-11 pl-9 text-base"
        />
        {open && canSuggest && suggestions.length > 0 && (
          <ul
            id="reno-address-listbox"
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          >
            {suggestions.map((s) => (
              <li key={`${s.label}-${s.lat}-${s.lng}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // Fire before input blur so the pick isn't lost.
                    e.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    void pick(s);
                  }}
                  className="flex min-h-[44px] w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground active:bg-accent"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status.kind === 'resolving' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Finding your neighbourhood…
        </p>
      )}
      {status.kind === 'matched' && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Set your area to <b>{status.community}</b>, {status.city}. Adjust below if it&apos;s off.
        </p>
      )}
      {status.kind === 'nomatch' && (
        <p className="text-xs text-muted-foreground">
          We couldn&apos;t pinpoint your exact neighbourhood — pick it below.
        </p>
      )}
    </div>
  );
}
