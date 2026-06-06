'use client';

import { useState } from 'react';
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

  // City is a type-ahead (150+ cities). Hold the raw input text locally; commit to
  // value.city only on an exact match (datalist pick / full type), clear on empty,
  // and leave a partial-but-unmatched query untouched so typing isn't wiped.
  const [cityQuery, setCityQuery] = useState(value.city);
  const [prevCity, setPrevCity] = useState(value.city);
  // Sync the input when value.city changes externally (prefill / rehydrate / reset):
  // adjust-state-during-render — React's recommended alternative to setState-in-effect.
  if (value.city !== prevCity) {
    setPrevCity(value.city);
    setCityQuery(value.city);
  }
  const onCityInput = (v: string) => {
    setCityQuery(v);
    if (v === '') {
      if (value.city !== '') onChange({ ...value, city: '', cityRegion: '', propertySubType: '' });
    } else if (cities.includes(v) && v !== value.city) {
      onChange({ ...value, city: v, cityRegion: '', propertySubType: '' });
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Location cascades ── */}
      <div className="grid grid-cols-1 gap-4">
        {/* City — type-ahead over 150+ cities (datalist; zero deps) */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">CITY</Label>
          <Input
            list="he-city-options"
            value={cityQuery}
            onChange={(e) => onCityInput(e.target.value)}
            placeholder="Type your city (e.g. Vaughan)"
            autoComplete="off"
            className="bg-black/20 border-gray-700 text-gray-100"
          />
          <datalist id="he-city-options">
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        {/* Community */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">COMMUNITY</Label>
          <Select
            value={value.cityRegion}
            onValueChange={(cityRegion) =>
              onChange({ ...value, cityRegion, propertySubType: '' })
            }
            disabled={!value.city}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100 disabled:opacity-40">
              <SelectValue placeholder="Select community" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
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
          <Label className="text-xs text-gray-400">PROPERTY TYPE</Label>
          <Select
            value={value.propertySubType}
            onValueChange={(propertySubType) => onChange({ ...value, propertySubType })}
            disabled={!value.cityRegion}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100 disabled:opacity-40">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
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
      <div className="grid grid-cols-3 gap-4">
        {/* Bedrooms */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">BEDROOMS</Label>
          <Select
            value={String(value.bedroomsAboveGrade)}
            onValueChange={(v) => onChange({ ...value, bedroomsAboveGrade: Number(v) })}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
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
          <Label className="text-xs text-gray-400">BATHROOMS</Label>
          <Select
            value={String(value.bathroomsTotalInteger)}
            onValueChange={(v) => onChange({ ...value, bathroomsTotalInteger: Number(v) })}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
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
          <Label className="text-xs text-gray-400">PARKING</Label>
          <Select
            value={String(value.parkingTotal)}
            onValueChange={(v) => onChange({ ...value, parkingTotal: Number(v) })}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
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
        <Label className="text-xs text-gray-400">CONDITION ASSESSMENT</Label>

        {/* Interior */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-gray-300">Interior</Label>
            <Select
              value={String(value.interiorTier)}
              onValueChange={(v) => onChange({ ...value, interiorTier: Number(v) })}
            >
              <SelectTrigger className="w-40 bg-black/20 border-gray-700 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
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
          <div className="flex items-center justify-between">
            <Label className="text-sm text-gray-300">Exterior</Label>
            <Select
              value={String(value.exteriorTier)}
              onValueChange={(v) => onChange({ ...value, exteriorTier: Number(v) })}
            >
              <SelectTrigger className="w-40 bg-black/20 border-gray-700 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
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
          <div className="flex items-center justify-between">
            <Label className="text-sm text-gray-300">Basement</Label>
            <Select
              value={String(value.basementTier)}
              onValueChange={(v) => onChange({ ...value, basementTier: Number(v) })}
            >
              <SelectTrigger className="w-40 bg-black/20 border-gray-700 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
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
        <Label className="text-xs text-gray-400">
          SQUARE FOOTAGE (OPTIONAL — IMPROVES ACCURACY)
        </Label>
        <Input
          type="number"
          min={1}
          value={value.buildingAreaTotal ?? ''}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            // Empty / unparseable / non-positive → omit (null): the API's
            // z.number().positive() would reject a literal 0 with a 400.
            onChange({
              ...value,
              buildingAreaTotal: e.target.value === '' || !Number.isFinite(n) || n <= 0 ? null : n,
            });
          }}
          placeholder="e.g. 1800"
          className="bg-black/20 border-gray-700 text-gray-100"
        />
      </div>
    </div>
  );
}
