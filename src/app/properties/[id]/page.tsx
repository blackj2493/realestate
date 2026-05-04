"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Bed, Bath, Car } from "lucide-react";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import MediaGallery from "@/components/MediaGallery";
import SpatialDistribution from "@/components/SpatialDistribution";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";

interface Room {
  RoomKey?: string;
  RoomType?: string;
  RoomLevel?: string;
  RoomDimensions?: string;
  RoomFeatures?: string;
  RoomLength?: number;
  RoomWidth?: number;
}

interface Property {
  ListingKey: string;
  ListPrice: number;
  City?: string;
  StateOrProvince?: string;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  ListOfficeName?: string;
  UnparsedAddress?: string;
  Utilities?: string;
  Water?: string;
  ExteriorFeatures?: string[];
  ParkingTotal?: number;
  ParkingType?: string;
  AnnualTaxes?: number;
  AssociationFee?: number;
  PublicRemarks?: string;
  TransactionType?: string;
  rooms?: Room[];
  media?: Array<{ MediaURL: string; MediaCategory?: string; MediaObjectID?: string }>;
  images?: Array<{ MediaURL: string; MediaCategory?: string; MediaObjectID?: string; Order?: number }>;
  listingHistory?: {
    dateStart: string;
    dateEnd?: string;
    price: number;
    event: string;
    listingId: string;
  }[];
  TaxAnnualAmount?: number;
  Latitude?: number;
  Longitude?: number;
  PostalCode?: string;
  ArchitecturalStyle?: string;
  Basement?: string[];
  DirectionFaces?: string;
  OriginalEntryTimestamp?: string;
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  CoveredSpaces?: number;
  KitchensTotal?: number;
  KitchensAboveGrade?: number;
  KitchensBelowGrade?: number;
  RoomsAboveGrade?: number;
  RoomsBelowGrade?: number;
  InteriorFeatures?: string[];
  ConstructionMaterials?: string[];
  FoundationDetails?: string[];
  Roof?: string[];
  LotWidth?: number;
  LotDepth?: number;
  LotSizeUnits?: string;
  LotSizeRangeAcres?: string;
  HeatType?: string;
  HeatSource?: string;
  Sewer?: string[];
  Cooling?: string[];
  Heating?: string;
  ParkingFeatures?: string[];
  PropertyFeatures?: string[];
  CityRegion?: string;
  PropertySubType?: string;
  StandardStatus?: string;
  DaysOnMarket?: number;
}

function calculateDaysOnMarket(originalEntryTimestamp: string | undefined): number {
  if (!originalEntryTimestamp) return 0;
  
  const listingDate = new Date(originalEntryTimestamp);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - listingDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) - 1;
  
  return diffDays;
}

// Trigger background quick-sync via API
async function triggerQuickSync(listingKey: string): Promise<void> {
  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'quick-sync',
        listingKey,
        priority: 'high'
      }),
    });
    
    if (!response.ok) {
      console.warn('[Quick-Sync] Failed to trigger sync for:', listingKey);
    } else {
      console.log('[Quick-Sync] Triggered for listing:', listingKey);
    }
  } catch (error) {
    console.error('[Quick-Sync] Error triggering sync:', error);
  }
}

export default function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  // In Next.js 15+, params is a Promise that must be unwrapped
  const { id } = React.use(params);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'triggering' | 'pending'>('idle');

  useEffect(() => {
    const fetchProperty = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // STEP 1: Fetch from API route (server-side Supabase call)
        console.log('[PropertyPage] Fetching listing via API:', id);
        
        const response = await fetch(`/api/property/${id}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            console.log('[PropertyPage] Listing not in database, triggering quick-sync:', id);
            setSyncStatus('triggering');
            await triggerQuickSync(id);
            setSyncStatus('pending');
            setError(`This listing is being synchronized. It will be available shortly.`);
            setProperty(null);
            setLoading(false);
            return;
          }
          throw new Error(`Failed to fetch: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.notFound) {
          console.log('[PropertyPage] Listing not found, triggering quick-sync:', id);
          setSyncStatus('triggering');
          await triggerQuickSync(id);
          setSyncStatus('pending');
          setError(`This listing is being synchronized. It will be available shortly.`);
          setProperty(null);
          setLoading(false);
          return;
        }
        
        // Extract images from media_urls
        const images: Array<{ MediaURL: string; MediaCategory?: string; MediaObjectID?: string; Order?: number }> = 
          (data.media_urls || []).map((url: string, index: number) => ({
            MediaURL: url,
            MediaCategory: 'Photo',
            MediaObjectID: `extracted-${index}`,
            Order: index,
          }));
        
        // Combine full_payload with extracted images
        const propertyData: Property = {
          ...(data.full_payload as Property || {}),
          images,
        };
        
        console.log(`[API] Fetched listing: ${id}`);
        
        setProperty(propertyData);
        setSyncStatus('idle');
      } catch (err) {
        console.error("Error fetching property:", err);
        const errorMessage = err instanceof Error ? err.message : "Failed to load property details";
        
        // If network error, try to trigger quick sync as fallback
        if (errorMessage.toLowerCase().includes('failed to fetch') || errorMessage.toLowerCase().includes('fetch')) {
          console.log('[PropertyPage] Network error, attempting quick-sync fallback...');
          setSyncStatus('triggering');
          await triggerQuickSync(id);
          setSyncStatus('pending');
          setError(`Unable to connect to database. The listing is being synchronized. Please refresh shortly.`);
        } else {
          setError(errorMessage);
        }
        
        setProperty(null);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchProperty();
    }
  }, [id]);

  // Loading state
  if (loading) return <LoadingSpinner />;
  
  // Error state with clean message
  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-4">Property {syncStatus === 'pending' ? 'Syncing...' : 'Not Found'}</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          {syncStatus === 'pending' ? (
            <div className="flex flex-col items-center gap-4">
              <div className="animate-pulse text-primary">Synchronizing listing data...</div>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Check Again
              </Button>
            </div>
          ) : (
            <Link href="/properties">
              <Button variant="outline">← Back to Listings</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }
  
  // Null state (shouldn't happen after error check but safety first)
  if (!property) return <div>Property not found</div>;

  // Combine images and media for the gallery
  const allMedia = [
    ...(property.images || []),
    ...(property.media || []).filter(
      (m) => !property.images?.some((img) => img.MediaURL === m.MediaURL)
    ),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <Link href="/properties" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
        ← Back to Listings
      </Link>

      {/* Media Gallery - Full Width */}
      <MediaGallery 
        media={allMedia.filter(item => item.MediaCategory === 'Photo')}
      />

      {/* Property Header - Full Width */}
      <div className="mt-8">
        <h1 className="text-3xl font-bold">{property.UnparsedAddress}</h1>
        <div className="text-2xl font-bold text-primary mt-2">
          ${property.ListPrice?.toLocaleString()}
        </div>
        <div className="flex gap-4 mt-4 text-lg">
          <div className="flex items-center gap-2">
            <Bed className="h-5 w-5" />
            <span>{property.BedroomsAboveGrade || 0}+{property.BedroomsBelowGrade || 0} beds</span>
          </div>
          <div className="flex items-center gap-2">
            <Bath className="h-5 w-5" />
            <span>{property.BathroomsTotalInteger} baths</span>
          </div>
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            <span>{property.CoveredSpaces || 0} Garage</span>
          </div>
          <div className="text-muted-foreground font-bold">
            Listed {calculateDaysOnMarket(property.OriginalEntryTimestamp)} days ago
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        {/* Left Column - Description and Details */}
        <div className="lg:col-span-2">
          {/* Property Description */}
          <section className="bg-card rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold mb-4">Description</h2>
            <p className="text-muted-foreground whitespace-pre-line">
              {property.PublicRemarks}
            </p>
          </section>

          {/* Property Summary */}
          <section className="mt-8 bg-card rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold mb-4">Property Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <p className="text-muted-foreground">Property Type</p>
                <p className="font-medium">{property.PropertySubType || "Single Family"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Building Type</p>
                <p className="font-medium">{property.PropertySubType || "Semi-detached"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Building Style</p>
                <p className="font-medium">{property.ArchitecturalStyle || "Not Available"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Days on Market</p>
                <p className="font-medium">{calculateDaysOnMarket(property.OriginalEntryTimestamp)} days</p>
              </div>
              <div>
                <p className="text-muted-foreground">Land Size</p>
                <p className="font-medium">{property.LotWidth} x {property.LotDepth} {property.LotSizeUnits}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Annual Property Taxes</p>
                <p className="font-medium">{property.TaxAnnualAmount ? `$${property.TaxAnnualAmount.toLocaleString()}` : "Not Available"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Parking Spaces</p>
                <p className="font-medium">{property.ParkingTotal || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Basement</p>
                <p className="font-medium">{property.Basement ? property.Basement.join(", ") : "Not Available"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Facing</p>
                <p className="font-medium">{property.DirectionFaces || "Not Available"}</p>
              </div>
            </div>
          </section>

          {/* Details Card */}
          <section className="mt-8 bg-card rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold mb-4">Details</h2>
            
            {/* Interior */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Interior Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-muted-foreground">Kitchens</p>
                  <p className="font-medium">{property.KitchensTotal || 0} ({property.KitchensAboveGrade || 0} above, {property.KitchensBelowGrade || 0} below)</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rooms</p>
                  <p className="font-medium">{property.RoomsAboveGrade || 0} above, {property.RoomsBelowGrade || 0} below</p>
                </div>
                {property.InteriorFeatures && property.InteriorFeatures.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Features</p>
                    <p className="font-medium">{property.InteriorFeatures.join(", ")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Construction */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Construction & Structure</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {property.ConstructionMaterials && property.ConstructionMaterials.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Materials</p>
                    <p className="font-medium">{property.ConstructionMaterials.join(", ")}</p>
                  </div>
                )}
                {property.FoundationDetails && property.FoundationDetails.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Foundation</p>
                    <p className="font-medium">{property.FoundationDetails.join(", ")}</p>
                  </div>
                )}
                {property.Roof && property.Roof.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Roof</p>
                    <p className="font-medium">{property.Roof.join(", ")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Lot Details */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Lot Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-muted-foreground">Lot Dimensions</p>
                  <p className="font-medium">{property.LotWidth || "N/A"} x {property.LotDepth || "N/A"} {property.LotSizeUnits || ""}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lot Size Range</p>
                  <p className="font-medium">{property.LotSizeRangeAcres || "Not Available"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Direction Faces</p>
                  <p className="font-medium">{property.DirectionFaces || "Not Available"}</p>
                </div>
              </div>
            </div>

            {/* Systems & Utilities */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Systems & Utilities</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {property.Cooling && property.Cooling.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Cooling</p>
                    <p className="font-medium">{property.Cooling.join(", ")}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Heating</p>
                  <p className="font-medium">{property.HeatType || "Not Available"} ({property.HeatSource || "N/A"})</p>
                </div>
                {property.Sewer && property.Sewer.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Sewer</p>
                    <p className="font-medium">{property.Sewer.join(", ")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Parking & Exterior */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Parking & Exterior</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {property.ParkingFeatures && property.ParkingFeatures.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Parking Features</p>
                    <p className="font-medium">{property.ParkingFeatures.join(", ")}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">Total Parking Spaces</p>
                  <p className="font-medium">{property.ParkingTotal || 0}</p>
                </div>
                {property.ExteriorFeatures && property.ExteriorFeatures.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">Exterior Features</p>
                    <p className="font-medium">{property.ExteriorFeatures.join(", ")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Property Features */}
            {property.PropertyFeatures && property.PropertyFeatures.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-3">Property Features</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <p className="text-muted-foreground">Nearby</p>
                    <p className="font-medium">{property.PropertyFeatures.join(", ")}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Listed By Card */}
          <section className="mt-8 bg-card rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-2">Listed By</h3>
            <p className="text-muted-foreground">{property.ListOfficeName || "Office information not available"}</p>
          </section>

          {/* Spatial Distribution Visualizer */}
          {property.rooms && property.rooms.length > 0 && (
            <SpatialDistribution 
              rooms={property.rooms} 
              title="Room Spatial Distribution" 
            />
          )}
        </div>

        {/* Right Column - Contact & Mortgage Calculator */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-6">
            {/* Contact Card */}
            <Card>
              <CardHeader>
                <CardTitle>Interested in this property?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Contact the listing agent for more information or to schedule a viewing.
                </p>
                <Button className="w-full" size="lg">
                  Contact Agent
                </Button>
              </CardContent>
            </Card>

            {/* Mortgage Calculator */}
            <Card>
              <CardHeader>
                <CardTitle>Mortgage Calculator</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Property Price</label>
                    <p className="text-lg font-bold text-primary">{formatPrice(property.ListPrice)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Annual Property Tax</label>
                    <p className="text-muted-foreground">
                      {property.TaxAnnualAmount ? formatPrice(property.TaxAnnualAmount) : "N/A"}
                    </p>
                  </div>
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Estimated Monthly Payment*
                    </p>
                    <p className="text-2xl font-bold">
                      {formatPrice(Math.round(property.ListPrice / 300))}/mo
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      *Based on 20% down payment, 30-year fixed rate
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}