'use client';

import { useState, useRef } from 'react';
import type { CohortTree } from '@/lib/avm/cohorts';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import RenoAddressField from '@/components/reno/RenoAddressField';

// Mirror AVMPropertyForm label arrays exactly
// Human-readable condition labels (no cryptic tier numbers shown to the user).
const INTERIOR_LABELS = ['', 'Executive (luxury)', 'Premium (updated)', 'Standard (average)', 'Economy (dated)', 'Minimal (original)'];
const EXTERIOR_LABELS = ['', 'Executive (luxury)', 'Premium (updated)', 'Standard (average)', 'Economy (dated)', 'Minimal (original)'];
// Basement uses only the labelled tiers 1/3/5/7/9 (best → none).
const BASEMENT_LABELS = [
  '',
  'Finished — high-end',
  '',
  'Finished — standard',
  '',
  'Unfinished',
  '',
  'Partial / crawl space',
  '',
  'None',
];

export interface HEFormState {
  city: string;
  cityRegion: string;            // RAW city_region (lookup key) — value of the community select
  propertySubType: string;
  bedroomsAboveGrade: number;
  bathroomsTotalInteger: number;
  parkingTotal: number;
  interiorTier: number;          // 1–5 (default 3)
  exteriorTier: number;          // 1–5 (default 3)
  basementTier: number;          // 1–9 (default 5)
  buildingAreaTotal: number | null; // optional sqft
}

interface HiddenEquityFormProps {
  tree: CohortTree;
  value: HEFormState;
  onChange: (next: HEFormState) => void;
}

export default function HiddenEquityForm({ tree, value, onChange }: HiddenEquityFormProps) {
  const cities = Object.keys(tree); // already sorted by buildCohortTree
  const communities = value.city ? (tree[value.city] ?? []) : [];
  const selectedCommunity = communities.find((c) => c.cityRegion === value.cityRegion);
  const types = selectedCommunity?.types ?? [];

  // City is a type-ahead (150+ cities) implemented as a self-owned combobox.
  // We deliberately avoid <datalist>: on iOS Safari the datalist suggestion
  // cascade is unreliable and intermittently swallows the OS keyboard's own
  // suggestion bar. Instead we hold the raw input text locally, render our own
  // filtered list, and commit to value.city on an exact (trimmed, case-insensitive)
  // match or on a tap. Clearing the field clears the cascade; a partial-but-
  // unmatched query is left untouched so typing isn't wiped.
  const [cityQuery, setCityQuery] = useState(value.city);
  const [prevCity, setPrevCity] = useState(value.city);
  const [cityOpen, setCityOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sync the input when value.city changes externally (prefill / rehydrate / reset):
  // adjust-state-during-render — React's recommended alternative to setState-in-effect.
  if (value.city !== prevCity) {
    setPrevCity(value.city);
    setCityQuery(value.city);
  }

  // Canonical, case-insensitive, trimmed match → the exact key in `cities`.
  const matchCity = (raw: string): string | undefined => {
    const q = raw.trim().toLowerCase();
    return cities.find((c) => c.toLowerCase() === q);
  };

  const q = cityQuery.trim().toLowerCase();
  // Suggestions: substring match, capped so the list stays phone-friendly.
  const citySuggestions =
    q === ''
      ? cities.slice(0, 8)
      : cities.filter((c) => c.toLowerCase().includes(q)).slice(0, 8);

  const commitCity = (city: string) => {
    setCityQuery(city);
    setCityOpen(false);
    if (city !== value.city) {
      onChange({ ...value, city, cityRegion: '', propertySubType: '' });
    }
  };

  const onCityInput = (v: string) => {
    setCityQuery(v);
    setCityOpen(true);
    if (v.trim() === '') {
      if (value.city !== '') onChange({ ...value, city: '', cityRegion: '', propertySubType: '' });
      return;
    }
    const exact = matchCity(v);
    if (exact && exact !== value.city) {
      onChange({ ...value, city: exact, cityRegion: '', propertySubType: '' });
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Address-first entry — resolves city + community into the tree, best-effort ── */}
      <RenoAddressField
        tree={tree}
        onResolve={(r) =>
          onChange({
            ...value,
            city: r.city || value.city,
            cityRegion: r.cityRegion,
            propertySubType: '',
          })
        }
      />

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden />
        or pick manually
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      {/* ── Location cascades ── */}
      <div className="grid grid-cols-1 gap-4">
        {/* City — self-owned filtered combobox (no <datalist>: unreliable on iOS) */}
        <div className="relative space-y-2">
          <Label className="text-xs text-muted-foreground" htmlFor="he-city-input">
            CITY
          </Label>
          <Input
            id="he-city-input"
            role="combobox"
            aria-expanded={cityOpen && citySuggestions.length > 0}
            aria-autocomplete="list"
            aria-controls="he-city-listbox"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="words"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={cityQuery}
            onChange={(e) => onCityInput(e.target.value)}
            onFocus={() => setCityOpen(true)}
            onBlur={() => {
              // Delay so an option mousedown/tap can commit before we close;
              // on plain blur, snap a trimmed exact match to canonical casing.
              blurTimer.current = setTimeout(() => {
                setCityOpen(false);
                const exact = matchCity(cityQuery);
                if (exact) setCityQuery(exact);
              }, 120);
            }}
            placeholder="Type your city (e.g. Vaughan)"
            className="h-11 text-base"
          />
          {cityOpen && citySuggestions.length > 0 && (
            <ul
              id="he-city-listbox"
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
            >
              {citySuggestions.map((c) => (
                <li key={c} role="option" aria-selected={c === value.city}>
                  <button
                    type="button"
                    // onMouseDown fires before input blur, so the commit isn't lost.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (blurTimer.current) clearTimeout(blurTimer.current);
                      commitCity(c);
                    }}
                    className="flex min-h-[44px] w-full items-center px-3 text-left text-sm hover:bg-accent hover:text-accent-foreground active:bg-accent"
                  >
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Community */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">COMMUNITY</Label>
          <Select
            value={value.cityRegion}
            onValueChange={(cityRegion) =>
              onChange({ ...value, cityRegion, propertySubType: '' })
            }
            disabled={!value.city}
          >
            <SelectTrigger className="h-11 disabled:opacity-40 sm:h-10">
              <SelectValue placeholder="Select community" />
            </SelectTrigger>
            <SelectContent>
              {communities.map((c) => (
                <SelectItem key={c.cityRegion} value={c.cityRegion}>
                  {c.community}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Property type */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">PROPERTY TYPE</Label>
          <Select
            value={value.propertySubType}
            onValueChange={(propertySubType) => onChange({ ...value, propertySubType })}
            disabled={!value.cityRegion}
          >
            <SelectTrigger className="h-11 disabled:opacity-40 sm:h-10">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Home details ── */}
      <div className="grid grid-cols-3 gap-2">
        {/* Bedrooms */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">BEDROOMS</Label>
          <Select
            value={String(value.bedroomsAboveGrade)}
            onValueChange={(v) => onChange({ ...value, bedroomsAboveGrade: Number(v) })}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bathrooms */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">BATHROOMS</Label>
          <Select
            value={String(value.bathroomsTotalInteger)}
            onValueChange={(v) => onChange({ ...value, bathroomsTotalInteger: Number(v) })}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Parking */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">PARKING</Label>
          <Select
            value={String(value.parkingTotal)}
            onValueChange={(v) => onChange({ ...value, parkingTotal: Number(v) })}
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Condition assessment ── */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">CONDITION ASSESSMENT</Label>

        {/* Interior */}
        <div className="space-y-2">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <Label className="text-sm text-foreground">Interior</Label>
            <Select
              value={String(value.interiorTier)}
              onValueChange={(v) => onChange({ ...value, interiorTier: Number(v) })}
            >
              <SelectTrigger className="h-11 w-full sm:h-10 sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {INTERIOR_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Exterior */}
        <div className="space-y-2">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <Label className="text-sm text-foreground">Exterior</Label>
            <Select
              value={String(value.exteriorTier)}
              onValueChange={(v) => onChange({ ...value, exteriorTier: Number(v) })}
            >
              <SelectTrigger className="h-11 w-full sm:h-10 sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {EXTERIOR_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Basement */}
        <div className="space-y-2">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <Label className="text-sm text-foreground">Basement</Label>
            <Select
              value={String(value.basementTier)}
              onValueChange={(v) => onChange({ ...value, basementTier: Number(v) })}
            >
              <SelectTrigger className="h-11 w-full sm:h-10 sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 5, 7, 9].map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {BASEMENT_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Optional square footage ── */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          SQUARE FOOTAGE (OPTIONAL — IMPROVES ACCURACY)
        </Label>
        <Input
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          value={value.buildingAreaTotal ?? ''}
          onChange={(e) => {
            // type=text + inputMode=numeric gives the numeric keypad without iOS
            // spinner/zoom quirks; strip non-numeric chars before parsing.
            const cleaned = e.target.value.replace(/[^\d.]/g, '');
            const n = parseFloat(cleaned);
            // Empty / unparseable / non-positive → omit (null): the API's
            // z.number().positive() would reject a literal 0 with a 400.
            onChange({
              ...value,
              buildingAreaTotal: cleaned === '' || !Number.isFinite(n) || n <= 0 ? null : n,
            });
          }}
          placeholder="e.g. 1800"
          className="h-11 text-base sm:h-10"
        />
      </div>
    </div>
  );
}
