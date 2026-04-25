"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  MapPin,
  Clock,
  Heart,
  Map,
  X,
  Loader2,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";

interface SearchDropdownProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (query: string) => void;
  placeholder?: string;
  searchType?: "buy" | "rent";
  onSearchTypeChange?: (type: "buy" | "rent") => void;
  listingType?: "residential" | "commercial";
  onListingTypeChange?: (type: "residential" | "commercial") => void;
  className?: string;
  autoFocus?: boolean;
}

interface AutocompleteSuggestion {
  type: "city" | "neighborhood" | "mls" | "address";
  text: string;
  city?: string;
}

interface SavedProperty {
  id: string;
  address: string;
  price: number;
  photoUrl?: string;
}

interface RecentlyViewed {
  id: string;
  address: string;
  price: number;
  photoUrl?: string;
  viewedAt: Date;
}

import { CITIES, searchCities, type CityOption } from "@/lib/cities";

// Canadian cities for quick search (most popular cities)
const QUICK_SEARCH_CITIES = [
  "Toronto",
  "Mississauga",
  "Brampton",
  "Markham",
  "Oakville",
  "Burlington",
  "Milton",
  "Richmond Hill",
  "Vaughan",
  "Hamilton",
  "Ottawa",
  "London",
  "Kitchener",
  "Cambridge",
  "Waterloo",
  "Guelph",
  "Oshawa",
  "Barrie",
];

// Simulated autocomplete suggestions (in production, this would be an API call)
const generateSuggestions = (query: string): AutocompleteSuggestion[] => {
  if (!query || query.length < 2) return [];

  const lowerQuery = query.toLowerCase();
  const suggestions: AutocompleteSuggestion[] = [];

  // Check if it looks like an MLS number
  if (/^mls|#|^\d{6,}$/i.test(query)) {
    suggestions.push({
      type: "mls",
      text: `MLS# ${query.toUpperCase()}`,
    });
  }

  // City matches from real city data
  const matchingCities = searchCities(query);
  matchingCities.forEach((city) => {
    suggestions.push({
      type: "city",
      text: city.name,
    });
  });

  // Neighborhood matches (sample)
  const neighborhoods = [
    { name: "Waterfront", city: "Toronto" },
    { name: "Downtown Core", city: "Toronto" },
    { name: "Liberty Village", city: "Toronto" },
    { name: "Queen West", city: "Toronto" },
    { name: "The Junction", city: "Toronto" },
    { name: "Parkdale", city: "Toronto" },
    { name: "Rosedale", city: "Toronto" },
    { name: "Forest Hill", city: "Toronto" },
    { name: "Yorkville", city: "Toronto" },
    { name: "Distillery District", city: "Toronto" },
    { name: "Church Wellesley", city: "Toronto" },
    { name: "Cabbagetown", city: "Toronto" },
    { name: "Leslieville", city: "Toronto" },
    { name: "Beaches", city: "Toronto" },
    { name: "Danforth", city: "Toronto" },
    { name: "North York", city: "Toronto" },
    { name: "Scarborough", city: "Toronto" },
    { name: "Etobicoke", city: "Toronto" },
  ];

  neighborhoods.forEach((n) => {
    if (n.name.toLowerCase().includes(lowerQuery)) {
      suggestions.push({
        type: "neighborhood",
        text: n.name,
        city: n.city,
      });
    }
  });

  // Address matches (sample)
  if (query.length >= 3) {
    const sampleAddresses = [
      { address: "123 Yonge Street, Toronto", mls: "MLS123456" },
      { address: "456 King Street West, Toronto", mls: "MLS123457" },
      { address: "789 Bay Street, Toronto", mls: "MLS123458" },
      { address: "321 Queen Street East, Toronto", mls: "MLS123459" },
      { address: "555 Wellington Street West, Toronto", mls: "MLS123460" },
    ];

    sampleAddresses.forEach((a) => {
      if (a.address.toLowerCase().includes(lowerQuery)) {
        suggestions.push({
          type: "address",
          text: a.address,
        });
      }
    });
  }

  return suggestions.slice(0, 8);
};

// Custom hook for managing recently viewed
function useRecentlyViewed() {
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewed[]>([]);

  useEffect(() => {
    // Load from localStorage
    const stored = localStorage.getItem("recentlyViewed");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setRecentlyViewed(parsed.map((item: RecentlyViewed) => ({
          ...item,
          viewedAt: new Date(item.viewedAt),
        })));
      } catch {
        setRecentlyViewed([]);
      }
    }
  }, []);

  const addToRecentlyViewed = (property: Omit<RecentlyViewed, "viewedAt">) => {
    const newItem: RecentlyViewed = {
      ...property,
      viewedAt: new Date(),
    };

    setRecentlyViewed((prev) => {
      const filtered = prev.filter((p) => p.id !== property.id);
      const updated = [newItem, ...filtered].slice(0, 5);
      localStorage.setItem("recentlyViewed", JSON.stringify(updated));
      return updated;
    });
  };

  const clearRecentlyViewed = () => {
    setRecentlyViewed([]);
    localStorage.removeItem("recentlyViewed");
  };

  return { recentlyViewed, addToRecentlyViewed, clearRecentlyViewed };
}

// Custom hook for managing saved homes
function useSavedHomes() {
  const [savedHomes, setSavedHomes] = useState<SavedProperty[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("savedHomes");
    if (stored) {
      try {
        setSavedHomes(JSON.parse(stored));
      } catch {
        setSavedHomes([]);
      }
    }
  }, []);

  const toggleSave = (property: SavedProperty) => {
    setSavedHomes((prev) => {
      const exists = prev.some((p) => p.id === property.id);
      let updated: SavedProperty[];
      if (exists) {
        updated = prev.filter((p) => p.id !== property.id);
      } else {
        updated = [...prev, property];
      }
      localStorage.setItem("savedHomes", JSON.stringify(updated));
      return updated;
    });
  };

  const removeSaved = (id: string) => {
    setSavedHomes((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      localStorage.setItem("savedHomes", JSON.stringify(updated));
      return updated;
    });
  };

  const isSaved = (id: string) => savedHomes.some((p) => p.id === id);

  return { savedHomes, toggleSave, removeSaved, isSaved };
}

export function SearchDropdown({
  value,
  onChange,
  onSearch,
  placeholder = "Search by city, neighborhood, or MLS#",
  searchType = "buy",
  onSearchTypeChange,
  listingType = "residential",
  onListingTypeChange,
  className = "",
  autoFocus = false,
}: SearchDropdownProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const { recentlyViewed, clearRecentlyViewed } = useRecentlyViewed();
  const { savedHomes, removeSaved, isSaved } = useSavedHomes();

  // Generate suggestions when input changes
  useEffect(() => {
    if (value.length >= 2) {
      setIsLoading(true);
      // Simulate API delay
      const timer = setTimeout(() => {
        setSuggestions(generateSuggestions(value));
        setIsLoading(false);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
    }
  }, [value]);

  // Show dropdown when there's content or recent items
  useEffect(() => {
    setIsOpen(value.length > 0 || recentlyViewed.length > 0 || savedHomes.length > 0);
  }, [value, recentlyViewed, savedHomes]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      setIsOpen(false);
      if (onSearch) {
        onSearch(value);
      } else {
        router.push(`/properties?search=${encodeURIComponent(value)}&type=${searchType}&listingType=${listingType}`);
      }
    }
  };

  const handleSuggestionClick = (suggestion: AutocompleteSuggestion) => {
    let searchValue = suggestion.text;
    if (suggestion.type === "city" || suggestion.type === "neighborhood") {
      searchValue = suggestion.city ? `${suggestion.text}, ${suggestion.city}` : suggestion.text;
    }
    onChange(searchValue);
    setIsOpen(false);
    router.push(`/properties?search=${encodeURIComponent(searchValue)}&type=${searchType}&listingType=${listingType}`);
  };

  const handleCityClick = (cityName: string) => {
    onChange(cityName);
    setIsOpen(false);
    router.push(`/properties?search=${encodeURIComponent(cityName)}&type=${searchType}&listingType=${listingType}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = suggestions.length;
    if (totalItems === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % totalItems);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + totalItems) % totalItems);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSuggestionClick(suggestions[highlightedIndex]);
        } else {
          handleSubmit(e as any);
        }
        break;
      case "Escape":
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const hasContent = value.length > 0 || recentlyViewed.length > 0 || savedHomes.length > 0;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            className="pl-10 h-12 pr-10"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Toggle Rows */}
        <div className="flex flex-wrap gap-2 mt-3">
          {/* Residential / Commercial Toggle */}
          {onListingTypeChange && (
            <div className="inline-flex rounded-md border bg-background">
              <button
                type="button"
                onClick={() => onListingTypeChange("residential")}
                className={`px-4 h-10 rounded-l-md text-sm font-medium transition-colors ${
                  listingType === "residential"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                Residential
              </button>
              <button
                type="button"
                onClick={() => onListingTypeChange("commercial")}
                className={`px-4 h-10 rounded-r-md text-sm font-medium transition-colors ${
                  listingType === "commercial"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                Commercial
              </button>
            </div>
          )}

          {/* Buy / Rent Toggle */}
          {onSearchTypeChange && (
            <div className="inline-flex rounded-md border bg-background">
              <button
                type="button"
                onClick={() => onSearchTypeChange("buy")}
                className={`px-4 h-10 rounded-l-md text-sm font-medium transition-colors ${
                  searchType === "buy"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => onSearchTypeChange("rent")}
                className={`px-4 h-10 rounded-r-md text-sm font-medium transition-colors ${
                  searchType === "rent"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                Rent
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Dropdown */}
      {isOpen && hasContent && (
        <Card className="absolute top-full left-0 right-0 mt-2 z-50 shadow-xl border max-h-[80vh] overflow-hidden">
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Autocomplete Suggestions */}
            {value.length >= 2 && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Suggestions
                </div>
                {isLoading ? (
                  <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : suggestions.length > 0 ? (
                  suggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.type}-${suggestion.text}`}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className={`w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted transition-colors ${
                        highlightedIndex === index ? "bg-muted" : ""
                      }`}
                    >
                      <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium truncate">{suggestion.text}</span>
                        {suggestion.city && (
                          <span className="text-sm text-muted-foreground ml-2">
                            {suggestion.city}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground capitalize">
                        {suggestion.type}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    No suggestions found
                  </div>
                )}
              </div>
            )}

            {/* Quick Search */}
            {!value && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Quick Search
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SEARCH_CITIES.slice(0, 6).map((city) => (
                    <button
                      key={city}
                      onClick={() => handleCityClick(city)}
                      className="px-3 py-1.5 text-sm bg-muted hover:bg-primary hover:text-primary-foreground rounded-full transition-colors"
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* More Cities (when typing) */}
            {value.length >= 2 && (
              <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Map className="h-4 w-4" />
                Cities
              </div>
            )}
            {value.length >= 2 &&
              QUICK_SEARCH_CITIES.map((city) => {
                if (city.toLowerCase().includes(value.toLowerCase())) {
                  return (
                    <button
                      key={city}
                      onClick={() => handleCityClick(city)}
                      className="w-full px-4 py-2 flex items-center justify-between hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{city}</span>
                      </div>
                    </button>
                  );
                }
                return null;
              })}

            {/* Divider */}
            {(suggestions.length > 0 || value.length >= 2) && (recentlyViewed.length > 0 || savedHomes.length > 0) && (
              <div className="border-t my-2" />
            )}

            {/* Recently Viewed */}
            {recentlyViewed.length > 0 && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recently Viewed
                  </div>
                  <button
                    onClick={clearRecentlyViewed}
                    className="text-xs text-primary hover:underline"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {recentlyViewed.slice(0, 3).map((property) => (
                    <Link
                      key={property.id}
                      href={`/properties/${property.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                    >
                      <div className="w-12 h-12 rounded bg-muted flex-shrink-0 overflow-hidden">
                        {property.photoUrl ? (
                          <img
                            src={property.photoUrl}
                            alt={property.address}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{property.address}</p>
                        <p className="text-primary font-semibold text-sm">
                          {formatPrice(property.price)}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* My Saved Homes */}
            {savedHomes.length > 0 && (
              <div className="p-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  My Saved Homes
                </div>
                <div className="space-y-2">
                  {savedHomes.slice(0, 3).map((property) => (
                    <div
                      key={property.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors group"
                    >
                      <Link
                        href={`/properties/${property.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <div className="w-12 h-12 rounded bg-muted flex-shrink-0 overflow-hidden">
                          {property.photoUrl ? (
                            <img
                              src={property.photoUrl}
                              alt={property.address}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{property.address}</p>
                          <p className="text-primary font-semibold text-sm">
                            {formatPrice(property.price)}
                          </p>
                        </div>
                      </Link>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          removeSaved(property.id);
                        }}
                        className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-100 transition-all"
                        title="Remove from saved"
                      >
                        <X className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
                {savedHomes.length > 3 && (
                  <Link
                    href="/dashboard?saved=true"
                    onClick={() => setIsOpen(false)}
                    className="mt-3 block text-sm text-primary hover:underline"
                  >
                    View all {savedHomes.length} saved homes →
                  </Link>
                )}
              </div>
            )}

            {/* Map Search Option */}
            <div className="p-4 border-t">
              <Link
                href="/map"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary font-medium transition-colors"
              >
                <Map className="h-4 w-4" />
                Search by Map
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
