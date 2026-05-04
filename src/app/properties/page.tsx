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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import { type ListingDocument, type SearchResult, type SearchFilters } from "@/lib/typesense/client";
import CommandCenterSidebar, { type PersonaType, type InvestorFilters, type ValueAddFilters } from "@/components/Sidebar/CommandCenterSidebar";
import TerminalMap from "@/components/Map/TerminalMap";

// ============================================================================
// Typesense Data Mapping
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

/**
 * Maps Typesense ListingDocument to MapView Property format
 */
function mapTypesenseToProperty(doc: ListingDocument): PropertyForMap {
  // Use Latitude/Longitude from API response (looked up from postal codes)
  // Fall back to Typesense location only if not available
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

function PropertiesPageContent() {
  // Get URL search params (Brampton, Toronto, etc.)
  const searchParams = useSearchParams();
  
  // ========== FILTER STATES ==========
  
  // Transaction Type - read from URL
  const [intent, setIntent] = useState<"buy" | "rent">(searchParams.get("type") === "rent" ? "rent" : "buy");
  
  // Location - read from URL search param
  const [location, setLocation] = useState(searchParams.get("search") || searchParams.get("city") || "");
  
  // Sync location state with URL when it changes
  useEffect(() => {
    const searchCity = searchParams.get("search") || searchParams.get("city") || "";
    if (searchCity !== location) {
      console.log('[PropertiesPage] URL param changed:', searchCity);
      setLocation(searchCity);
    }
  }, [searchParams, location]);
  
  // API state - Typesense results
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  
  // Map bounds state
  const [mapBounds, setMapBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);

  // Convert properties to map-compatible format
  const properties = searchResult?.listings.map(mapTypesenseToProperty) || [];

  const toggleSave = (id: string) => {
    // Save functionality placeholder
  };

  // Handle map bounds change
  const handleBoundsChange = useCallback((bounds: { north: number; south: number; east: number; west: number }) => {
    setMapBounds(bounds);
  }, []);

  // ========== TYPESENSE SEARCH ==========

  const performSearch = useCallback(async (filters?: SearchFilters) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Build query params
      const params = new URLSearchParams({
        page: '1',
        limit: '200',
        type: intent === "buy" ? "buy" : "rent",
        listingType: 'residential',
      });
      
      // Add location if set
      if (location) {
        params.set('city', location);
      }
      
      // Add filters from Command Center
      if (filters) {
        if (filters.minPrice) params.set('minPrice', filters.minPrice.toString());
        if (filters.maxPrice) params.set('maxPrice', filters.maxPrice.toString());
        if (filters.minBedrooms) params.set('BedroomsAboveGrade', filters.minBedrooms.toString());
        if (filters.minBathrooms) params.set('BathroomsTotalInteger', filters.minBathrooms.toString());
        if (filters.maxTaxes) params.set('MaxAnnualTaxes', filters.maxTaxes.toString());
        if (filters.maxDOM) params.set('MinDaysOnMarket', (365 - filters.maxDOM).toString());
        if (filters.city) params.set('city', filters.city);
      }
      
      const url = `/api/properties/listings?${params.toString()}`;
      console.log('[PropertiesPage] Fetching:', url);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `API error ${response.status}`);
      }
      
      const data = await response.json();
      
      // Transform API response to SearchResult format
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
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable. Please try again.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [location, intent]);

  // Re-search when location changes from URL
  useEffect(() => {
    console.log('[PropertiesPage] Location/intent changed - re-searching');
    console.log('[PropertiesPage] intent:', intent, 'location:', location);
    performSearch();
  }, [location, intent, performSearch]);
  
  // Handle Command Center sidebar filter changes
  const handleCommandCenterFilters = useCallback((
    _persona: PersonaType,
    investorFilters: InvestorFilters,
    valueAddFilters: ValueAddFilters
  ) => {
    // Build search filters from Command Center
    const filters: SearchFilters = {};

    // Yield Investor filters
    if (investorFilters.minPrice > 0) filters.minPrice = investorFilters.minPrice;
    if (investorFilters.maxPrice < 5000000) filters.maxPrice = investorFilters.maxPrice;
    if (investorFilters.minYield > 0) filters.minTargetGrossYield = investorFilters.minYield;
    if (investorFilters.minYield > 0) filters.maxTargetGrossYield = investorFilters.maxYield;
    if (investorFilters.hasSuitePotential) filters.hasSecondarySuitePotential = true;
    if (investorFilters.isDistressed) filters.isDistressed = true;
    if (investorFilters.minBedrooms > 0) filters.minBedrooms = investorFilters.minBedrooms;
    if (investorFilters.maxBedrooms < 10) filters.maxBedrooms = investorFilters.maxBedrooms;

    // Value-Add / Developer filters (applied together with yield filters for flexibility)
    if (valueAddFilters.minLotWidth > 0) filters.minLotWidth = valueAddFilters.minLotWidth;
    if (valueAddFilters.maxLotWidth < 200) filters.maxLotWidth = valueAddFilters.maxLotWidth;
    if (valueAddFilters.minLotDepth > 0) filters.minLotDepth = valueAddFilters.minLotDepth;
    if (valueAddFilters.maxLotDepth < 500) filters.maxLotDepth = valueAddFilters.maxLotDepth;
    if (valueAddFilters.hasUnfinishedBasement) filters.hasUnfinishedBasement = true;
    if (valueAddFilters.hasDetachedGarage) filters.hasDetachedGarage = true;
    if (valueAddFilters.minDOM > 0) filters.minDOM = valueAddFilters.minDOM;
    if (valueAddFilters.maxDOM < 365) filters.maxDOM = valueAddFilters.maxDOM;

    // Trigger search with new filters (debounce happens in sidebar)
    performSearch(filters);
  }, [performSearch]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-slate-900/95 backdrop-blur">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">PP</span>
              </div>
              <span className="text-xl font-bold text-slate-100">PureProperty</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/properties" className="text-sm font-medium text-emerald-400">
                Buy
              </Link>
              <Link href="/properties?type=rent" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Rent
              </Link>
              <Link href="/analytics" className="text-sm font-medium text-slate-400 hover:text-slate-200">
                Market Analytics
              </Link>
            </nav>
            <div className="flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost" className="text-slate-300">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button className="bg-emerald-600 hover:bg-emerald-700">Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content: Sidebar + Map */}
      <div className="flex-1 flex">
        {/* Command Center Sidebar */}
        <div className="w-80 flex-shrink-0 border-r border-slate-800">
          <CommandCenterSidebar 
            onFiltersChange={handleCommandCenterFilters}
            className="h-[calc(100vh-4rem)]"
          />
        </div>

        {/* Map Area */}
        <div className="flex-1 flex flex-col">
          {/* Terminal Map - 3D Visualization */}
          <div className="flex-1 h-full min-h-[400px] border-b border-slate-800">
            <TerminalMap
              properties={searchResult?.listings || []}
              className="w-full h-full"
            />
          </div>

          {/* Results Panel */}
          <div className="flex-1 overflow-y-auto p-4 bg-slate-900">
            {/* Results Count */}
            <div className="flex items-center justify-between mb-4">
              {isLoading ? (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </p>
              ) : (
                <p className="text-sm text-slate-400">
                  <span className="font-semibold text-slate-100">{totalCount || properties.length}</span> properties found
                  {location && <span> in {location}</span>}
                  {searchResult && (
                    <span className="text-xs ml-2 text-slate-500">
                      ({searchResult.processingTimeMs}ms)
                    </span>
                  )}
                </p>
              )}
              <p className="text-xs text-slate-500">
                PROPTX MLS®
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg text-sm text-amber-300">
                {error}
              </div>
            )}

            {/* Property Grid */}
            {properties.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {properties.map((property) => {
                  const id = property.ListingKey;
                  const address = property.UnparsedAddress || 'Address Unavailable';
                  const price = property.ListPrice;
                  const city = property.City || 'Unknown';
                  const propertyType = property.PropertyType || 'Residential';
                  const bedrooms = property.BedroomsTotal || 0;
                  const bathrooms = property.BathroomsTotalInteger || 0;
                  const squareFeet = property.BuildingAreaTotal;
                  const brokerage = property.ListOfficeName || 'Unknown';
                  const dom = property.DaysOnMarket || 0;
                  const photoUrl = property.photoUrl || "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400";
                  
                  return (
                    <Link key={id} href={`/properties/${id}`}>
                      <Card className="group bg-slate-800 border-slate-700 overflow-hidden hover:border-emerald-600/50 hover:shadow-lg hover:shadow-emerald-900/20 transition-all duration-300 cursor-pointer h-full">
                        <div className="relative aspect-[16/10]">
                          <Image
                            src={photoUrl}
                            alt={address}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSave(id);
                            }}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-900/70 hover:bg-slate-900 transition-colors z-10"
                          >
                            <Heart className="h-4 w-4 text-slate-300" />
                          </button>
                          <div className="absolute bottom-2 left-2">
                            <span className="px-2 py-0.5 bg-slate-900/90 text-emerald-400 text-xs font-mono rounded">
                              {dom}d
                            </span>
                          </div>
                        </div>
                        <CardContent className="p-3">
                          <div className="text-lg font-bold text-emerald-400 font-mono mb-1">
                            {formatPrice(price)}
                          </div>
                          <h3 className="text-sm font-medium text-slate-200 mb-1 line-clamp-1">
                            {address}
                          </h3>
                          <p className="text-xs text-slate-500 mb-2">
                            {city}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-slate-400">
                            <div className="flex items-center gap-1">
                              <Bed className="h-3 w-3" />
                              <span className="font-mono">{bedrooms}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Bath className="h-3 w-3" />
                              <span className="font-mono">{bathrooms}</span>
                            </div>
                            {squareFeet && (
                              <div className="flex items-center gap-1">
                                <Square className="h-3 w-3" />
                                <span className="font-mono">{squareFeet.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Map className="h-16 w-16 text-slate-700 mb-4" />
                <h3 className="text-sm font-medium text-slate-400 mb-2">No properties found</h3>
                <p className="text-xs text-slate-500">Adjust your filters or zoom out on the map</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-4 border-t border-slate-800 bg-slate-900">
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
