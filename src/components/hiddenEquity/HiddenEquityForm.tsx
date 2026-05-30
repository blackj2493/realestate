'use client';

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
const INTERIOR_LABELS = ['', 'Executive', 'Premium', 'Standard', 'Economy', 'Minimal'];
const EXTERIOR_LABELS = ['', 'Executive', 'Premium', 'Standard', 'Economy', 'Minimal'];
const BASEMENT_LABELS = [
  '',
  'Custom/Finished',
  '',
  'Full Finished',
  '',
  'Full Unfinished',
  '',
  'Partial',
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

  return (
    <div className="space-y-4">
      {/* ── Location cascades ── */}
      <div className="grid grid-cols-1 gap-4">
        {/* City */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-400">CITY</Label>
          <Select
            value={value.city}
            onValueChange={(city) =>
              onChange({ ...value, city, cityRegion: '', propertySubType: '' })
            }
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                    {t} — {INTERIOR_LABELS[t]}
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
                    {t} — {EXTERIOR_LABELS[t]}
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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {t} — {BASEMENT_LABELS[t]}
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
