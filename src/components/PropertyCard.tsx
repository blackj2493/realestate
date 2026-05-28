"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MapPin,
  Bed,
  Bath,
  Square,
  Heart,
  Calendar,
  Home,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatPrice, cn } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

export interface PropertyCardData {
  id: string;
  listingId: string;
  address: string;
  city: string;
  province?: string;
  price: number;
  previousPrice?: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  squareFeet?: number;
  daysOnMarket?: number;
  brokerage?: string;
  latitude?: number | null;
  longitude?: number | null;
  photoUrl?: string | null;
  photoUrls?: string[];
  description?: string;
  parkingSpaces?: number;
  yearBuilt?: number | null;
  maintenance?: number;
  distance?: number;
  // Phase 5: Suite Status
  suiteStatus?: 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE';
  suiteScore?: number;
  // Phase 5: Stale Inventory
  isStale?: boolean;
}

interface PropertyCardProps {
  property: PropertyCardData;
  showDistance?: boolean;
  showSaveButton?: boolean;
  variant?: "default" | "compact";
}

export function PropertyCard({
  property,
  showDistance = false,
  showSaveButton = true,
  variant = "default",
}: PropertyCardProps) {
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSaved(!isSaved);
  };

  // Determine if price was reduced
  const priceReduced = property.previousPrice && property.previousPrice > property.price;
  const priceDiff = priceReduced ? (property.previousPrice ?? 0) - property.price : 0;

  const getDaysText = (days: number) => {
    if (days === 0) return "Today";
    if (days === 1) return "1 day";
    if (days < 7) return `${days} days`;
    if (days < 30) return `${Math.floor(days / 7)} wks`;
    return `${Math.floor(days / 30)} mos`;
  };

  const getPropertyTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      "Detached": "House",
      "Semi-Detached": "Semi-Det",
      "Townhouse": "Townhouse",
      "Condo": "Condo",
      "Apartment": "Apartment",
      "Row": "Row House",
      "Link": "Link House",
      "Duplex": "Duplex",
      "Triplex": "Triplex",
      "Fourplex": "Fourplex",
      "Multifamily": "Multi-Family",
      "Vacant Land": "Land",
    };
    return labels[type] || type;
  };

  if (variant === "compact") {
    return (
      <Link href={`/properties/${property.id}`}>
        <Card className="group overflow-hidden hover:shadow-md transition-all cursor-pointer">
          <div className="flex">
            <ListingThumbnail
              src={property.photoUrl}
              alt={property.address}
              className="w-32 h-24 shrink-0"
              sizes="128px"
            />
            <CardContent className="p-3 flex-1">
              <div className="text-lg font-bold text-primary">
                {formatPrice(property.price)}
              </div>
              <p className="text-sm font-medium line-clamp-1">{property.address}</p>
              <p className="text-xs text-muted-foreground">
                {property.city} • {getPropertyTypeLabel(property.propertyType)}
              </p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Bed className="h-3 w-3" />
                  {property.bedrooms}
                </span>
                <span className="flex items-center gap-1">
                  <Bath className="h-3 w-3" />
                  {property.bathrooms}
                </span>
              </div>
            </CardContent>
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Link href={`/properties/${property.id}`}>
      <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer">
        {/* Image Container (thumbnail + absolute-positioned overlays) */}
        <div className="relative aspect-[4/3]">
          <ListingThumbnail
            src={property.photoUrl}
            alt={property.address}
            className="absolute inset-0"
            imgClassName="group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
          {/* Save Button */}
          {showSaveButton && (
            <button
              onClick={handleSave}
              className="absolute top-3 right-3 p-2 rounded-full bg-white/90 hover:bg-white transition-colors shadow-sm z-10"
              aria-label={isSaved ? "Remove from saved" : "Save property"}
            >
              <Heart
                className={`h-5 w-5 ${
                  isSaved
                    ? "fill-red-500 text-red-500"
                    : "text-gray-600 hover:text-red-500"
                }`}
              />
            </button>
          )}

          {/* Badges */}
          <div className="absolute top-3 left-3 flex flex-col gap-2">
            {/* Suite Status Badge (top-left) - highest priority */}
            {property.suiteStatus === 'EXISTING_SUITE' && (
              <span className="px-2 py-1 text-xs font-mono font-semibold text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-md">
                EXISTING DUPLEX/SUITE
              </span>
            )}
            {property.suiteStatus === 'POTENTIAL_CANDIDATE' && (
              <span className="px-2 py-1 text-xs font-mono font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-md">
                ALPHA: SUITE CANDIDATE
              </span>
            )}
            {/* New listing badge */}
            {property.daysOnMarket !== undefined && property.daysOnMarket <= 7 && (
              <span className="px-2 py-1 bg-emerald-500 text-white text-xs font-medium rounded">
                New
              </span>
            )}
            {showDistance && property.distance !== undefined && (
              <span className="px-2 py-1 bg-primary text-primary-foreground text-xs font-medium rounded flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {property.distance < 1 
                  ? `${Math.round(property.distance * 1000)}m` 
                  : `${property.distance.toFixed(1)}km`}
              </span>
            )}
          </div>

          {/* Right Side Badges */}
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            {/* DoM Badge (bottom-right) - if > 45 days show, if > 90 show STALE */}
            {property.isStale ? (
              <span className="px-2 py-1 text-xs font-mono font-semibold text-rose-400 bg-rose-400/10 border border-rose-400/20 rounded-md">
                STALE: {property.daysOnMarket || 0}d
              </span>
            ) : property.daysOnMarket !== undefined && property.daysOnMarket > 45 ? (
              <span className="px-2 py-1 text-xs font-mono font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-md">
                {property.daysOnMarket}d
              </span>
            ) : null}
          </div>

          {/* Days on Market Badge */}
          {property.daysOnMarket !== undefined && (
            <div className="absolute bottom-3 left-3">
              <span className="px-2 py-1 bg-black/70 text-white text-xs font-medium rounded flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {getDaysText(property.daysOnMarket)}
              </span>
            </div>
          )}

          {/* Price Reduced Badge */}
          {priceReduced && (
            <div className="absolute bottom-3 right-3">
              <span className="px-2 py-1 bg-red-500 text-white text-xs font-medium rounded flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                -{formatPrice(priceDiff)}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <CardContent className="p-4">
          {/* Price */}
          <div className="mb-2">
            <span className="text-2xl font-bold text-primary">
              {formatPrice(property.price)}
            </span>
            {property.maintenance && property.maintenance > 0 && (
              <span className="text-sm text-muted-foreground ml-1">
                + {formatPrice(property.maintenance)}/mo
              </span>
            )}
          </div>

          {/* Address */}
          <h3 className="font-semibold mb-1 line-clamp-1 text-base">
            {property.address}
          </h3>
          
          {/* City & Type */}
          <p className="text-sm text-muted-foreground mb-3 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {property.city}
            </span>
            <span className="text-muted-foreground/50">•</span>
            <span className="flex items-center gap-1">
              <Home className="h-3 w-3" />
              {getPropertyTypeLabel(property.propertyType)}
            </span>
          </p>

          {/* Features Row — no border-b: brokerage line below must not be visually
              separated from the listing details per TRREB IDX §6.3(c). */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {property.bedrooms > 0 && (
              <div className="flex items-center gap-1.5">
                <Bed className="h-4 w-4" />
                <span className="font-medium">{property.bedrooms}</span>
                <span className="text-xs">bed</span>
              </div>
            )}
            {property.bathrooms > 0 && (
              <div className="flex items-center gap-1.5">
                <Bath className="h-4 w-4" />
                <span className="font-medium">{property.bathrooms}</span>
                <span className="text-xs">bath</span>
              </div>
            )}
            {property.squareFeet && property.squareFeet > 0 && (
              <div className="flex items-center gap-1.5">
                <Square className="h-4 w-4" />
                <span className="font-medium">{property.squareFeet.toLocaleString()}</span>
                <span className="text-xs">sqft</span>
              </div>
            )}
          </div>

          {/* Brokerage — text-sm matches the Features Row above, satisfying TRREB
              §6.3(c) ("same font and size as the other Listing details"). */}
          <p className="mt-2 text-sm text-muted-foreground">
            Listed by {property.brokerage || "Unknown"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
