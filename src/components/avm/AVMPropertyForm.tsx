/**
 * AVM Property Form Component
 * 
 * Left panel: Input form with tier selectors for property features.
 */

'use client';

import { useAVMStore } from '@/store/useAVMStore';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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

export function AVMPropertyForm() {
  const {
    cityRegion,
    propertySubType,
    bedroomsAboveGrade,
    bathroomsTotalInteger,
    parkingTotal,
    interiorTier,
    exteriorTier,
    basementTier,
    setField,
  } = useAVMStore();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cityRegion" className="text-xs text-gray-400">
            CITY REGION
          </Label>
          <Input
            id="cityRegion"
            value={cityRegion}
            onChange={(e) => setField('cityRegion', e.target.value)}
            placeholder="e.g., Maple"
            className="bg-black/20 border-gray-700 text-gray-100 text-base md:text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="propertySubType" className="text-xs text-gray-400">
            PROPERTY TYPE
          </Label>
          <Select
            value={propertySubType}
            onValueChange={(v) => setField('propertySubType', v)}
          >
            <SelectTrigger className="bg-black/20 border-gray-700 text-gray-100">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
              <SelectItem value="Townhouse">Townhouse</SelectItem>
              <SelectItem value="Detached">Detached</SelectItem>
              <SelectItem value="Semi-Detached">Semi-Detached</SelectItem>
              <SelectItem value="Condo Townhouse">Condo Townhouse</SelectItem>
              <SelectItem value="Condo Apartment">Condo Apartment</SelectItem>
              <SelectItem value="Link">Link</SelectItem>
              <SelectItem value="Freehold">Freehold</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="bedrooms" className="text-xs text-gray-400">
            BEDROOMS
          </Label>
          <Select
            value={String(bedroomsAboveGrade)}
            onValueChange={(v) => setField('bedroomsAboveGrade', Number(v))}
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
        <div className="space-y-2">
          <Label htmlFor="bathrooms" className="text-xs text-gray-400">
            BATHROOMS
          </Label>
          <Select
            value={String(bathroomsTotalInteger)}
            onValueChange={(v) => setField('bathroomsTotalInteger', Number(v))}
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
        <div className="space-y-2">
          <Label htmlFor="parking" className="text-xs text-gray-400">
            PARKING
          </Label>
          <Select
            value={String(parkingTotal)}
            onValueChange={(v) => setField('parkingTotal', Number(v))}
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

      <div className="space-y-3">
        <Label className="text-xs text-gray-400">CONDITION ASSESSMENT</Label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="interiorTier" className="text-sm text-gray-300">
              Interior
            </Label>
            <Select
              value={String(interiorTier)}
              onValueChange={(v) => setField('interiorTier', Number(v))}
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="exteriorTier" className="text-sm text-gray-300">
              Exterior
            </Label>
            <Select
              value={String(exteriorTier)}
              onValueChange={(v) => setField('exteriorTier', Number(v))}
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="basementTier" className="text-sm text-gray-300">
              Basement
            </Label>
            <Select
              value={String(basementTier)}
              onValueChange={(v) => setField('basementTier', Number(v))}
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
    </div>
  );
}