"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Search, MapPin, Filter, X } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface PropertyResponse {
  listings: PropertyCardData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

function ListingsPageContent() {
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [priceRange, setPriceRange] = useState([0, 5000000]);
  const [bedrooms, setBedrooms] = useState("any");
  const [bathrooms, setBathrooms] = useState("any");
  const [propertyType, setPropertyType] = useState("all");

  // Check if a search has been performed
  const isSearchActive = Boolean(
    searchParams?.get("city") ||
      searchParams?.get("address") ||
      searchParams?.get("search")
  );

  const city = searchParams?.get("city") || searchParams?.get("search") || "";

  useEffect(() => {
    fetchProperties(1);
  }, [city]);

  const fetchProperties = async (pageNum: number) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (city) {
        params.set("city", city);
      }

      // Add filters
      if (priceRange[0] > 0) params.set("minPrice", priceRange[0].toString());
      if (priceRange[1] < 5000000) params.set("maxPrice", priceRange[1].toString());
      if (bedrooms !== "any") params.set("BedroomsTotal", bedrooms);
      if (bathrooms !== "any") params.set("BathroomsTotalInteger", bathrooms);
      if (propertyType !== "all") params.set("PropertySubType", propertyType);

      params.set("page", pageNum.toString());
      params.set("limit", "50");

      const response = await fetch(`/api/properties/listings?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch properties");
      }

      const data: PropertyResponse = await response.json();

      if (pageNum === 1) {
        setProperties(data.listings || []);
      } else {
        setProperties((prev) => [...prev, ...(data.listings || [])]);
      }

      setHasMore(data.pagination?.hasMore ?? false);
      setError(null);
    } catch (err) {
      console.error("Error fetching properties:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch properties");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // Navigate to search with the query
      window.location.href = `/listings?search=${encodeURIComponent(searchQuery)}`;
    }
  };

  const loadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchProperties(nextPage);
    }
  };

  const applyFilters = () => {
    setPage(1);
    setProperties([]);
    fetchProperties(1);
  };

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
        {/* Search Bar */}
        <div className="bg-card rounded-xl shadow-sm border p-4 mb-6">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by city, neighborhood, or MLS#"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <div className="flex gap-2">
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Property Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Detached">House</SelectItem>
                  <SelectItem value="Condo">Condo</SelectItem>
                  <SelectItem value="Townhouse">Townhouse</SelectItem>
                  <SelectItem value="Semi-Detached">Semi-Detached</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </form>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="text-sm font-medium mb-3 block">
                  Price Range: {formatPrice(priceRange[0])} - {formatPrice(priceRange[1])}
                </label>
                <Slider
                  value={priceRange}
                  onValueChange={setPriceRange}
                  max={5000000}
                  step={50000}
                  className="mt-4"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Bedrooms</label>
                <Select value={bedrooms} onValueChange={setBedrooms}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Bathrooms</label>
                <Select value={bathrooms} onValueChange={setBathrooms}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowFilters(false)}>
                  Cancel
                </Button>
                <Button onClick={applyFilters}>Apply Filters</Button>
              </div>
            </div>
          )}
        </div>

        {/* Results Count */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{properties.length}</span> properties found
            {city && <span> in {city}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            Listing data provided by PROPTX MLS®
          </p>
        </div>

        {error ? (
          <Card className="p-8 text-center">
            <p className="text-red-500 mb-4">{error}</p>
            <Button onClick={() => fetchProperties(1)}>Try Again</Button>
          </Card>
        ) : (
          <>
            {/* Property Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>

            {/* Loading More */}
            {loading && properties.length > 0 && (
              <div className="mt-8 text-center">
                <LoadingSpinner />
              </div>
            )}

            {/* Initial Loading */}
            {loading && properties.length === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="overflow-hidden">
                    <div className="aspect-[4/3] bg-muted animate-pulse" />
                    <CardContent className="p-4">
                      <div className="h-6 w-24 bg-muted animate-pulse rounded mb-2" />
                      <div className="h-4 w-full bg-muted animate-pulse rounded mb-2" />
                      <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!loading && properties.length === 0 && (
              <Card className="p-12 text-center">
                <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Properties Found</h3>
                <p className="text-muted-foreground mb-4">
                  We couldn't find any properties matching your criteria.
                </p>
                <Link href="/listings">
                  <Button>Browse All Properties</Button>
                </Link>
              </Card>
            )}

            {/* Load More Button */}
            {hasMore && properties.length > 0 && !loading && (
              <div className="mt-8 text-center">
                <Button onClick={loadMore} variant="outline" size="lg">
                  Load More Properties
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="py-8 border-t mt-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PureProperty. All rights reserved.</p>
          <p className="mt-2 text-xs">
            The information provided herein must only be used by consumers that have a bona fide
            interest in the purchase, sale, or lease of real estate.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function ListingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    }>
      <ListingsPageContent />
    </Suspense>
  );
}
