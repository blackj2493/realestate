"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  MapPin,
  Bed,
  Bath,
  Square,
  Heart,
  Loader2,
  Search,
  RotateCcw,
  Building2,
  Home,
  DollarSign,
  Calendar,
  Car,
  LayoutGrid,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import { searchCities, type CityOption } from "@/lib/cities";
import { searchListings, type ListingDocument, type SearchResult } from "@/lib/typesense/client";

// Sample property data (fallback)
const sampleProperties = [
  {
    id: "1",
    listingId: "MLS123456",
    address: "123 Yonge Street, Toronto",
    city: "Toronto",
    price: 1250000,
    propertyType: "Condo",
    bedrooms: 2,
    bathrooms: 2,
    squareFeet: 1200,
    photoUrls: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800"],
    brokerage: "EXP Realty",
    daysOnMarket: 12,
  },
];

// Pill button component
function PillButton({ 
  label, 
  selected, 
  onClick,
  small = false
}: { 
  label: string; 
  selected: boolean; 
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-medium rounded-full border transition-all ${
        selected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:border-primary/50"
      } ${small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5"}`}
    >
      {label}
    </button>
  );
}

// Pill group component
function PillGroup({ 
  value, 
  onChange, 
  options,
  small = false
}: { 
  value: string; 
  onChange: (value: string) => void;
  options: string[];
  small?: boolean;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((option) => (
        <PillButton
          key={option}
          label={option}
          selected={value === option}
          onClick={() => onChange(option)}
          small={small}
        />
      ))}
    </div>
  );
}

// Section header component
function SectionHeader({ 
  icon: Icon, 
  title 
}: { 
  icon: any; 
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-border mb-3">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
  );
}

// Dual control slider with synced input
function DualControlSlider({
  label,
  value,
  onValueChange,
  max,
  prefix = "$",
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  max: number;
  prefix?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{prefix}</span>
          <Input
            type="number"
            value={value || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              if (val <= max) onValueChange(val);
            }}
            className="w-24 h-8 text-sm"
            placeholder="Any"
          />
        </div>
      </div>
      <Slider
        value={[value || 0]}
        onValueChange={(vals) => onValueChange(vals[0])}
        max={max}
        step={50}
        className="py-1"
      />
    </div>
  );
}

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
    // Typesense location is [lat, lng], MapView expects Lat/Lng separate
    Latitude: doc.location[0],
    Longitude: doc.location[1],
    ListOfficeName: doc.ListOfficeName,
  };
}

function PropertiesPageContent() {
  const searchParams = useSearchParams();
  
  // ========== FILTER STATES ==========
  
  // Location & Intent
  const [location, setLocation] = useState(searchParams.get("search") || "");
  const [sector, setSector] = useState<"residential" | "commercial">(
    (searchParams.get("listingType") as "residential" | "commercial") || "residential"
  );
  const [intent, setIntent] = useState<"buy" | "rent">(
    (searchParams.get("type") as "buy" | "rent") || "buy"
  );
  
  // Property Essentials
  const [bedrooms, setBedrooms] = useState<string>("Any");
  const [bathrooms, setBathrooms] = useState<string>("Any");
  
  // Structural Details
  const [garageFilter, setGarageFilter] = useState<string>("Any");
  const [basementFilter, setBasementFilter] = useState<string>("Any");
  
  // Financial Parameters
  const [maxAssociationFee, setMaxAssociationFee] = useState<number>(0);
  const [maxAnnualTaxes, setMaxAnnualTaxes] = useState<number>(0);
  
  // Market Status
  const [daysOnMarket, setDaysOnMarket] = useState<string>("Any");
  
  // API state - Typesense results
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  
  // Pagination
  const PROPERTIES_PER_ROW = 4;
  const ROWS_INITIAL = 10;
  const INITIAL_DISPLAY_COUNT = PROPERTIES_PER_ROW * ROWS_INITIAL;
  const [displayedCount, setDisplayedCount] = useState(INITIAL_DISPLAY_COUNT);
  
  // Map bounds state
  const [mapBounds, setMapBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Location autocomplete state
  const [locationSuggestions, setLocationSuggestions] = useState<CityOption[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Convert properties to map-compatible format
  const properties = searchResult?.listings.map(mapTypesenseToProperty) || [];
  const visibleProperties = properties.slice(0, displayedCount);
  const hasMore = properties.length > displayedCount;

  // ========== TYPESENSE SEARCH ==========

  const performSearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Build Typesense search options
      const searchOptions: Parameters<typeof searchListings>[0] = {
        query: location || '*',
        filters: {
          city: location || undefined,
          minBedrooms: bedrooms !== "Any" ? parseInt(bedrooms) : undefined,
          minBathrooms: bathrooms !== "Any" ? parseInt(bathrooms) : undefined,
          maxAssociationFee: maxAssociationFee > 0 ? maxAssociationFee : undefined,
          maxTaxes: maxAnnualTaxes > 0 ? maxAnnualTaxes : undefined,
          transactionType: intent === "buy" ? "For Sale" : "For Lease",
          maxDOM: daysOnMarket !== "Any" ? parseInt(daysOnMarket.replace("+", "")) : undefined,
          boundingBox: mapBounds || undefined,
        },
        page: 1,
        perPage: 200,  // Get more for client-side pagination
      };

      const result = await searchListings(searchOptions);
      setSearchResult(result);
      setTotalCount(result.totalFound);
      
      console.log(`[Typesense] Found ${result.totalFound} listings in ${result.processingTimeMs}ms`);
    } catch (err) {
      console.error("Typesense search error:", err);
      setError("Search service temporarily unavailable. Please try again.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [location, bedrooms, bathrooms, maxAssociationFee, maxAnnualTaxes, intent, daysOnMarket, mapBounds]);

  // Debounced search (300ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      performSearch();
    }, 300);
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [performSearch]);

  // Handle location input change with autocomplete
  const handleLocationChange = (value: string) => {
    setLocation(value);
    setHighlightedIndex(-1);
    if (value.length >= 1) {
      const suggestions = searchCities(value);
      setLocationSuggestions(suggestions);
      setShowSuggestions(true);
    } else {
      setLocationSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Handle suggestion selection
  const handleSuggestionSelect = (cityName: string) => {
    setLocation(cityName);
    setShowSuggestions(false);
    setLocationSuggestions([]);
    locationInputRef.current?.focus();
  };

  // Handle keyboard navigation
  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || locationSuggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < locationSuggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < locationSuggestions.length) {
          handleSuggestionSelect(locationSuggestions[highlightedIndex].name);
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        break;
    }
  };

  // Click outside handler for suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        locationInputRef.current &&
        !locationInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset Filters
  const resetFilters = () => {
    setLocation("");
    setSector("residential");
    setIntent("buy");
    setBedrooms("Any");
    setBathrooms("Any");
    setGarageFilter("Any");
    setBasementFilter("Any");
    setMaxAssociationFee(0);
    setMaxAnnualTaxes(0);
    setDaysOnMarket("Any");
    setMapBounds(null);
  };

  const toggleSave = (id: string) => {
    // Save functionality unchanged
  };

  const handleShowMore = () => {
    setDisplayedCount((prev) => prev + INITIAL_DISPLAY_COUNT);
  };

  // Handle map bounds change
  const handleBoundsChange = useCallback((bounds: { north: number; south: number; east: number; west: number }) => {
    setMapBounds(bounds);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">PP</span>
              </div>
              <span className="text-xl font-bold">PureProperty</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/properties" className="text-sm font-medium text-primary">
                Buy
              </Link>
              <Link href="/properties?type=rent" className="text-sm font-medium hover:text-primary">
                Rent
              </Link>
              <Link href="/analytics" className="text-sm font-medium hover:text-primary">
                Market Analytics
              </Link>
              <Link href="/neighborhoods" className="text-sm font-medium hover:text-primary">
                Neighborhoods
              </Link>
            </nav>
            <div className="flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Command Center Filter Panel */}
        <div className="bg-card rounded-xl shadow-sm border p-5 mb-6">
          {/* ===== LOCATION & INTENT ===== */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6">
            <div className="md:col-span-5">
              <SectionHeader icon={MapPin} title="Location & Intent" />
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                    <Input
                      ref={locationInputRef}
                      placeholder="City, neighborhood, or address..."
                      value={location}
                      onChange={(e) => handleLocationChange(e.target.value)}
                      onKeyDown={handleLocationKeyDown}
                      onFocus={() => {
                        if (location.length >= 1 && locationSuggestions.length > 0) {
                          setShowSuggestions(true);
                        }
                      }}
                      className="h-10 pl-10 pr-10"
                    />
                    {location && (
                      <button
                        type="button"
                        onClick={() => {
                          setLocation("");
                          setLocationSuggestions([]);
                          setShowSuggestions(false);
                          locationInputRef.current?.focus();
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                  {/* Autocomplete Suggestions Dropdown */}
                  {showSuggestions && locationSuggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto"
                    >
                      {locationSuggestions.map((city, index) => (
                        <button
                          key={city.name}
                          onClick={() => handleSuggestionSelect(city.name)}
                          className={`w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted transition-colors ${
                            highlightedIndex === index ? "bg-muted" : ""
                          }`}
                        >
                          <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{city.name}</span>
                            {city.regions && city.regions.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {city.regions.length} neighborhoods
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Sector Toggle */}
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <button
                    onClick={() => setSector("residential")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      sector === "residential"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Home className="h-4 w-4" />
                    Residential
                  </button>
                  <button
                    onClick={() => setSector("commercial")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      sector === "commercial"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Building2 className="h-4 w-4" />
                    Commercial
                  </button>
                </div>
                {/* Intent Toggle */}
                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <button
                    onClick={() => setIntent("buy")}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                      intent === "buy"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setIntent("rent")}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                      intent === "rent"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Rent
                  </button>
                </div>
              </div>
            </div>
            
            {/* ===== PROPERTY ESSENTIALS ===== */}
            <div className="md:col-span-4">
              <SectionHeader icon={Home} title="Property Essentials" />
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1.5 block">Bedrooms</label>
                  <PillGroup
                    value={bedrooms}
                    onChange={setBedrooms}
                    options={["Any", "1+", "2+", "3+", "4+"]}
                    small
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1.5 block">Bathrooms</label>
                  <PillGroup
                    value={bathrooms}
                    onChange={setBathrooms}
                    options={["Any", "1+", "2+", "3+"]}
                    small
                  />
                </div>
              </div>
            </div>
            
            {/* ===== STRUCTURAL DETAILS ===== */}
            <div className="md:col-span-3">
              <SectionHeader icon={LayoutGrid} title="Structural Details" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Garage</label>
                  <Select value={garageFilter} onValueChange={setGarageFilter}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Any">Any</SelectItem>
                      <SelectItem value="garage">Must have garage</SelectItem>
                      <SelectItem value="none">No garage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Basement</label>
                  <Select value={basementFilter} onValueChange={setBasementFilter}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Any">Any</SelectItem>
                      <SelectItem value="finished">Finished & Livable</SelectItem>
                      <SelectItem value="walkout">Sep. Entry & Walk-Out</SelectItem>
                      <SelectItem value="unfinished">Unfinished & Raw</SelectItem>
                      <SelectItem value="none">None / Crawl Space</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          
          {/* Row 2: Financial Parameters & Market Status */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4 border-t border-border">
            {/* ===== FINANCIAL PARAMETERS ===== */}
            <div className="md:col-span-6">
              <SectionHeader icon={DollarSign} title="Financial Parameters" />
              <div className="grid grid-cols-2 gap-4">
                <DualControlSlider
                  label="Max Association Fee"
                  value={maxAssociationFee}
                  onValueChange={setMaxAssociationFee}
                  max={2000}
                />
                <DualControlSlider
                  label="Max Annual Taxes"
                  value={maxAnnualTaxes}
                  onValueChange={setMaxAnnualTaxes}
                  max={20000}
                />
              </div>
            </div>
            
            {/* ===== MARKET STATUS ===== */}
            <div className="md:col-span-3">
              <SectionHeader icon={Calendar} title="Market Status" />
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Days on Market</label>
                <PillGroup
                  value={daysOnMarket}
                  onChange={setDaysOnMarket}
                  options={["Any", "30+", "60+", "90+"]}
                  small
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Find stale listings with negotiation potential
                </p>
              </div>
            </div>
            
            {/* ===== ACTIONS ===== */}
            <div className="md:col-span-3 flex items-end gap-2">
              <Button
                onClick={performSearch}
                className="flex-1 h-10 gap-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Apply Filters
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={resetFilters}
                className="h-10 px-3"
                title="Reset all filters"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{totalCount || properties.length}</span> properties found
              {location && <span> in {location}</span>}
              {searchResult && (
                <span className="text-xs ml-2 text-muted-foreground">
                  ({searchResult.processingTimeMs}ms)
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Listing data provided by PROPTX MLS®
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            {error}
          </div>
        )}


        {/* Property Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {visibleProperties.map((property) => {
            const id = property.ListingKey;
            const address = property.UnparsedAddress || 'Address Unavailable';
            const price = property.ListPrice;
            const city = property.City || 'Unknown';
            const propertyType = property.PropertyType || 'Residential';
            const bedrooms = property.BedroomsTotal || 0;
            const bathrooms = property.BathroomsTotalInteger || 0;
            const squareFeet = property.BuildingAreaTotal;
            const brokerage = property.ListOfficeName || 'Unknown';
            const daysOnMarket = property.DaysOnMarket || 0;
            const photoUrl = property.photoUrl || "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800";
            
            return (
              <Link key={id} href={`/properties/${id}`}>
                <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer h-full">
                  <div className="relative aspect-[4/3]">
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
                      }}
                      className="absolute top-3 right-3 p-2 rounded-full bg-white/90 hover:bg-white transition-colors z-10"
                    >
                      <Heart className="h-5 w-5 text-gray-600" />
                    </button>
                    <div className="absolute bottom-3 left-3">
                      <span className="px-2 py-1 bg-primary text-primary-foreground text-xs font-medium rounded">
                        {daysOnMarket} days on market
                      </span>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-primary mb-1">
                      {formatPrice(price)}
                    </div>
                    <h3 className="font-semibold mb-2 line-clamp-1">
                      {address}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      {city} • {propertyType}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Bed className="h-4 w-4" />
                        <span>{bedrooms}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Bath className="h-4 w-4" />
                        <span>{bathrooms}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Square className="h-4 w-4" />
                        <span>{squareFeet?.toLocaleString()} sqft</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Listed by: {brokerage}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* Show More Button */}
        {properties.length > 0 && (
          <div className="flex justify-center mt-8">
            <Button
              onClick={handleShowMore}
              variant="outline"
              className="px-8"
              disabled={isLoading || displayedCount >= properties.length}
            >
              {displayedCount >= properties.length ? (
                `Showing all ${properties.length} properties`
              ) : (
                `Show More (${Math.min(INITIAL_DISPLAY_COUNT, properties.length - displayedCount)} more)`
              )}
            </Button>
          </div>
        )}

        {/* No properties */}
        {properties.length === 0 && !isLoading && (
          <p className="text-center text-sm text-muted-foreground mt-8">
            No properties found
          </p>
        )}
      </div>

      {/* Disclaimer */}
      <div className="container mx-auto px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          The information provided herein must only be used by consumers that have a bona fide 
          interest in the purchase, sale, or lease of real estate and may not be used for any 
          commercial purpose or any other purpose.
        </p>
      </div>

      {/* Footer */}
      <footer className="py-8 border-t mt-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PureProperty. All rights reserved. | Powered by PROPTX MLS®</p>
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
