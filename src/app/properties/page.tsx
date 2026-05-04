"use client";

import { useState, useEffect, useCallback, Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Bed,
  Bath,
  Square,
  Heart,
  Loader2,
  Map,
  TrendingUp,
  Home,
  Hammer,
  DollarSign,
  Percent,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { formatPrice, cn } from "@/lib/utils";
import { type ListingDocument, type SearchResult, type SearchFilters } from "@/lib/typesense/client";
import TerminalMap from "@/components/Map/TerminalMap";

// ============================================================================
// Types
// ============================================================================

interface PropertyForMap {
  ListingKey: string;
  ListPrice: number;
  UnparsedAddress: string;
  City: string;
  PropertyType: string;
  BedroomsTotal: number;
  BathroomsTotalInteger: number;
  BuildingAreaTotal?: number;
  DaysOnMarket?: number;
  photoUrl: string | null;
  Latitude: number;
  Longitude: number;
  ListOfficeName?: string;
}

type PersonaType = "primary" | "yield" | "value-add";

// ============================================================================
// Data Mapping
// ============================================================================

function mapTypesenseToProperty(doc: ListingDocument): PropertyForMap {
  const lat = doc.Latitude ?? doc.location?.[0] ?? 43.6532;
  const lng = doc.Longitude ?? doc.location?.[1] ?? -79.3832;
  
  return {
    ListingKey: doc.id,
    ListPrice: doc.ListPrice,
    UnparsedAddress: doc.UnparsedAddress || 'Address Unavailable',
    City: doc.City || 'Unknown',
    PropertyType: doc.PropertyType || doc.PropertySubType || 'Residential',
    BedroomsTotal: doc.BedroomsTotal || 0,
    BathroomsTotalInteger: doc.BathroomsTotalInteger || 0,
    BuildingAreaTotal: doc.BuildingAreaTotal,
    DaysOnMarket: doc.calculatedDOM,
    photoUrl: doc.thumbnailUrl || null,
    Latitude: lat,
    Longitude: lng,
    ListOfficeName: doc.ListOfficeName,
  };
}

// ============================================================================
// Developer Persona Filter Bar Component
// ============================================================================

interface DeveloperFilters {
  minPrice: number;
  maxPrice: number;
  minYield: number;
  minBedrooms: number;
  maxDOM: number;
  hasSuitePotential: boolean;
  isDistressed: boolean;
  minLotWidth: number;
  minLotDepth: number;
}

const PERSONAS = [
  { id: "primary" as const, label: "Primary", icon: Home },
  { id: "yield" as const, label: "Yield", icon: TrendingUp },
  { id: "value-add" as const, label: "Value-Add", icon: Hammer },
];

function DeveloperFilterBar({ 
  activePersona, 
  onPersonaChange,
  filters,
  onFiltersChange
}: {
  activePersona: PersonaType;
  onPersonaChange: (p: PersonaType) => void;
  filters: DeveloperFilters;
  onFiltersChange: (f: DeveloperFilters) => void;
}) {
  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-3">
      <div className="flex items-center gap-6">
        {/* Persona Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">MODE:</span>
          <div className="flex bg-slate-800 rounded-lg p-0.5">
            {PERSONAS.map((persona) => {
              const Icon = persona.icon;
              return (
                <button
                  key={persona.id}
                  onClick={() => onPersonaChange(persona.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    activePersona === persona.id
                      ? "bg-emerald-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {persona.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-6 w-px bg-slate-700" />

        {/* Price Range */}
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-slate-400" />
          <span className="text-xs text-slate-500">Price:</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={filters.minPrice}
              onChange={(e) => onFiltersChange({ ...filters, minPrice: parseInt(e.target.value) || 0 })}
              className="w-24 h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
              placeholder="Min"
            />
            <span className="text-slate-600">—</span>
            <Input
              type="number"
              value={filters.maxPrice}
              onChange={(e) => onFiltersChange({ ...filters, maxPrice: parseInt(e.target.value) || 5000000 })}
              className="w-24 h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
              placeholder="Max"
            />
          </div>
        </div>

        {/* Yield (for Yield Investor mode) */}
        {activePersona === "yield" && (
          <>
            <div className="h-6 w-px bg-slate-700" />
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-slate-500">Min Yield:</span>
              <div className="w-32">
                <Slider
                  value={[filters.minYield]}
                  onValueChange={([v]) => onFiltersChange({ ...filters, minYield: v })}
                  min={0}
                  max={15}
                  step={0.5}
                  className="w-full"
                />
              </div>
              <span className="text-xs font-mono text-emerald-400 w-10">{filters.minYield}%</span>
            </div>
          </>
        )}

        {/* Bedrooms (for all modes) */}
        <div className="h-6 w-px bg-slate-700" />
        <div className="flex items-center gap-2">
          <Bed className="h-4 w-4 text-slate-400" />
          <span className="text-xs text-slate-500">Beds:</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onFiltersChange({ ...filters, minBedrooms: Math.max(0, filters.minBedrooms - 1) })}
              className="w-6 h-6 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <span className="w-8 text-center text-xs font-mono text-slate-200">{filters.minBedrooms}+</span>
            <button
              onClick={() => onFiltersChange({ ...filters, minBedrooms: Math.min(10, filters.minBedrooms + 1) })}
              className="w-6 h-6 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Days on Market */}
        <div className="h-6 w-px bg-slate-700" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Max DOM:</span>
          <Input
            type="number"
            value={filters.maxDOM}
            onChange={(e) => onFiltersChange({ ...filters, maxDOM: parseInt(e.target.value) || 365 })}
            className="w-20 h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
          />
        </div>

        {/* Toggles */}
        {activePersona === "yield" && (
          <>
            <div className="h-6 w-px bg-slate-700" />
            <button
              onClick={() => onFiltersChange({ ...filters, hasSuitePotential: !filters.hasSuitePotential })}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium border transition-all",
                filters.hasSuitePotential
                  ? "bg-emerald-900/30 border-emerald-700 text-emerald-300"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
              )}
            >
              Suite Potential
            </button>
            <button
              onClick={() => onFiltersChange({ ...filters, isDistressed: !filters.isDistressed })}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium border transition-all",
                filters.isDistressed
                  ? "bg-amber-900/30 border-amber-700 text-amber-300"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
              )}
            >
              Distressed
            </button>
          </>
        )}

        {/* Value-Add specific filters */}
        {activePersona === "value-add" && (
          <>
            <div className="h-6 w-px bg-slate-700" />
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">Lot:</span>
              <Input
                type="number"
                value={filters.minLotWidth}
                onChange={(e) => onFiltersChange({ ...filters, minLotWidth: parseInt(e.target.value) || 0 })}
                className="w-16 h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
                placeholder="Width"
              />
              <span className="text-slate-600">×</span>
              <Input
                type="number"
                value={filters.minLotDepth}
                onChange={(e) => onFiltersChange({ ...filters, minLotDepth: parseInt(e.target.value) || 0 })}
                className="w-16 h-8 bg-slate-800 border-slate-700 text-xs font-mono text-slate-200"
                placeholder="Depth"
              />
              <span className="text-xs text-slate-500">ft</span>
            </div>
          </>
        )}

        {/* Reset Button */}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-slate-500 hover:text-slate-300"
            onClick={() => onFiltersChange({
              minPrice: 0,
              maxPrice: 5000000,
              minYield: 0,
              minBedrooms: 0,
              maxDOM: 365,
              hasSuitePotential: false,
              isDistressed: false,
              minLotWidth: 0,
              minLotDepth: 0,
            })}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Property List Item Component
// ============================================================================

function PropertyListItem({ property }: { property: PropertyForMap }) {
  const [isSaved, setIsSaved] = useState(false);
  
  const placeholderImage = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400";
  const photoUrl = property.photoUrl || placeholderImage;
  
  return (
    <Link href={`/properties/${property.ListingKey}`}>
      <Card className="group bg-slate-800/50 border-slate-700/50 overflow-hidden hover:bg-slate-800 hover:border-emerald-600/50 transition-all cursor-pointer mb-2">
        <div className="flex">
          {/* Thumbnail */}
          <div className="relative w-32 h-24 shrink-0">
            <Image
              src={photoUrl}
              alt={property.UnparsedAddress}
              fill
              className="object-cover"
            />
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsSaved(!isSaved);
              }}
              className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/70 hover:bg-slate-900"
            >
              <Heart className={cn(
                "h-3 w-3",
                isSaved ? "fill-red-500 text-red-500" : "text-slate-400"
              )} />
            </button>
          </div>
          
          {/* Content */}
          <CardContent className="p-2 flex-1 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-bold text-emerald-400 font-mono">
                  {formatPrice(property.ListPrice)}
                </div>
                <p className="text-xs text-slate-300 line-clamp-1">
                  {property.UnparsedAddress}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                  {property.PropertyType}
                </div>
                {property.DaysOnMarket && (
                  <div className="text-[10px] text-amber-500 font-mono mt-0.5">
                    {property.DaysOnMarket}d
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="flex items-center gap-0.5">
                  <Bed className="h-3 w-3" />
                  <span className="font-mono">{property.BedroomsTotal}</span>
                </span>
                <span className="flex items-center gap-0.5">
                  <Bath className="h-3 w-3" />
                  <span className="font-mono">{property.BathroomsTotalInteger}</span>
                </span>
                {property.BuildingAreaTotal && (
                  <span className="flex items-center gap-0.5">
                    <Square className="h-3 w-3" />
                    <span className="font-mono">{property.BuildingAreaTotal.toLocaleString()}</span>
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-500">{property.City}</span>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}

// ============================================================================
// Main Properties Page
// ============================================================================

function PropertiesPageContent() {
  const searchParams = useSearchParams();
  
  // ========== STATES ==========
  
  const [intent, setIntent] = useState<"buy" | "rent">(searchParams.get("type") === "rent" ? "rent" : "buy");
  const [location, setLocation] = useState(searchParams.get("search") || searchParams.get("city") || "");
  
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  
  // Developer persona state
  const [activePersona, setActivePersona] = useState<PersonaType>("yield");
  
  const [developerFilters, setDeveloperFilters] = useState<DeveloperFilters>({
    minPrice: 0,
    maxPrice: 5000000,
    minYield: 0,
    minBedrooms: 0,
    maxDOM: 365,
    hasSuitePotential: false,
    isDistressed: false,
    minLotWidth: 0,
    minLotDepth: 0,
  });

  // Map bounds state
  const [mapBounds, setMapBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);

  // Convert properties to map-compatible format
  const properties = searchResult?.listings.map(mapTypesenseToProperty) || [];

  // Handle map bounds change
  const handleBoundsChange = useCallback((bounds: { north: number; south: number; east: number; west: number }) => {
    setMapBounds(bounds);
  }, []);

  // ========== TYPESENSE SEARCH ==========

  const performSearch = useCallback(async (filters?: DeveloperFilters) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        page: '1',
        limit: '200',
        type: intent === "buy" ? "buy" : "rent",
        listingType: 'residential',
      });
      
      if (location) {
        params.set('city', location);
      }
      
      if (filters) {
        if (filters.minPrice > 0) params.set('minPrice', filters.minPrice.toString());
        if (filters.maxPrice < 5000000) params.set('maxPrice', filters.maxPrice.toString());
        if (filters.minBedrooms > 0) params.set('BedroomsAboveGrade', filters.minBedrooms.toString());
        if (filters.maxDOM < 365) params.set('MinDaysOnMarket', (365 - filters.maxDOM).toString());
      }
      
      const url = `/api/properties/listings?${params.toString()}`;
      console.log('[PropertiesPage] Fetching:', url);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `API error ${response.status}`);
      }
      
      const data = await response.json();
      
      const result: SearchResult = {
        listings: data.listings.map((p: any) => ({
          id: p.ListingKey,
          ListPrice: p.ListPrice,
          UnparsedAddress: p.UnparsedAddress,
          City: p.City,
          PropertyType: p.PropertyType,
          PropertySubType: p.PropertySubType,
          BedroomsTotal: p.BedroomsTotal,
          BathroomsTotalInteger: p.BathroomsTotalInteger,
          BuildingAreaTotal: p.BuildingAreaTotal,
          calculatedDOM: p.DaysOnMarket,
          thumbnailUrl: p.photoUrl,
          ListOfficeName: p.ListOfficeName,
          location: p.Latitude && p.Longitude ? [p.Latitude, p.Longitude] : [43.6532, -79.3832] as [number, number],
          isDistressed: false,
          hasSecondarySuitePotential: false,
        })),
        totalFound: data.pagination?.total || data.listings.length,
        page: data.pagination?.page || 1,
        perPage: data.pagination?.limit || 200,
        processingTimeMs: 0,
      };
      
      setSearchResult(result);
      setTotalCount(result.totalFound);
      
      console.log(`[PropertiesPage] Found ${result.totalFound} listings`);
    } catch (err) {
      console.error("[PropertiesPage] Search error:", err);
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [location, intent]);

  // Initial search
  useEffect(() => {
    console.log('[PropertiesPage] Location/intent changed - re-searching');
    performSearch(developerFilters);
  }, [location, intent, performSearch]);

  // Handle filter changes with debounce
  const handleDeveloperFiltersChange = useCallback((newFilters: DeveloperFilters) => {
    setDeveloperFilters(newFilters);
    // Debounce search
    const timer = setTimeout(() => {
      performSearch(newFilters);
    }, 300);
    return () => clearTimeout(timer);
  }, [performSearch]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-slate-900/95 backdrop-blur">
        <div className="container mx-auto px-4">
          <div className="flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-emerald-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">PP</span>
              </div>
              <span className="text-lg font-bold text-slate-100">PureProperty</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              <Link href="/properties" className="text-sm font-medium text-emerald-400">
                Buy
              </Link>
              <Link href="/properties?type=rent" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Rent
              </Link>
              <Link href="/analytics" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Analytics
              </Link>
            </nav>
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-slate-300">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Developer Persona Filter Bar */}
      <DeveloperFilterBar
        activePersona={activePersona}
        onPersonaChange={setActivePersona}
        filters={developerFilters}
        onFiltersChange={handleDeveloperFiltersChange}
      />

      {/* Main Content: Map (left) + Property List (right) */}
      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 8rem)' }}>
        {/* Map Area - Left Side (60%) - Fixed, does not scroll */}
        <div className="w-[60%] border-r border-slate-800 shrink-0">
          <TerminalMap
            properties={searchResult?.listings || []}
            className="w-full h-full"
          />
        </div>

        {/* Property List - Right Side (40%) - Scrollable */}
        <div className="w-[40%] flex flex-col bg-slate-900 overflow-hidden">
          {/* Results Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
            {isLoading ? (
              <p className="text-sm text-slate-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching...
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                <span className="font-semibold text-slate-100">{totalCount || properties.length}</span> properties
                {location && <span className="text-slate-500"> in {location}</span>}
              </p>
            )}
            <span className="text-xs text-slate-600">
              PROPTX MLS®
            </span>
          </div>

          {/* Error message */}
          {error && (
            <div className="mx-4 mt-3 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg text-sm text-amber-300 shrink-0">
              {error}
            </div>
          )}

          {/* Property List - Scrollable */}
          <div className="flex-1 overflow-y-auto p-3">
            {properties.length > 0 ? (
              <div className="space-y-1">
                {properties.map((property) => (
                  <PropertyListItem key={property.ListingKey} property={property} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Map className="h-12 w-12 text-slate-700 mb-3" />
                <h3 className="text-sm font-medium text-slate-400 mb-1">No properties found</h3>
                <p className="text-xs text-slate-500">Adjust your filters or zoom out on the map</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-3 border-t border-slate-800 bg-slate-900">
        <div className="container mx-auto px-4 text-center text-xs text-slate-500">
          <p>© {new Date().getFullYear()} PureProperty. Shadow MLS Layer | PROPTX MLS®</p>
        </div>
      </footer>
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function PropertiesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    }>
      <PropertiesPageContent />
    </Suspense>
  );
}