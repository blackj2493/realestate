"use client";

import { useState, useCallback, useMemo, useEffect, memo, useRef } from "react";
import Map, { Marker, NavigationControl, GeolocateControl, Popup, MapRef } from "react-map-gl/mapbox";
import Supercluster from "supercluster";
import { MapPin, X, Bed, Bath, Heart, ExternalLink, Building2 } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import "mapbox-gl/dist/mapbox-gl.css";

// Property type matching your API response
interface Property {
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

interface MapViewProps {
  properties: Property[];
  selectedPropertyId?: string;
  onPropertySelect?: (propertyId: string) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  className?: string;
  defaultCenter?: [number, number];
  defaultZoom?: number;
}

interface ClusterProperties {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: string;
  property?: Property;
}

interface Point {
  type: "Feature";
  properties: ClusterProperties;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

// Memoized individual marker component
const PropertyMarker = memo(function PropertyMarker({
  property,
  isSelected,
  onClick,
}: {
  property: Property;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center justify-center
        w-9 h-9 rounded-full
        shadow-lg border-2 transition-all
        transform hover:scale-110 hover:z-10 cursor-pointer
        ${isSelected 
          ? "bg-primary text-primary-foreground border-primary scale-110 z-20" 
          : "bg-white text-foreground border-gray-200 hover:border-primary"
        }
      `}
      style={{ fontSize: "10px", fontWeight: 600 }}
    >
      {formatPrice(property.ListPrice).replace("$", "").replace(",000", "k").replace(",", "")}
    </button>
  );
});

// Cluster marker component
const ClusterMarker = memo(function ClusterMarker({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const size = Math.min(60, Math.max(30, 30 + Math.log10(count) * 15));
  
  return (
    <button
      onClick={onClick}
      className="
        flex items-center justify-center
        rounded-full
        bg-primary text-primary-foreground
        shadow-lg border-2 border-white
        transition-transform hover:scale-110
        font-semibold cursor-pointer
      "
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(11, 14 - Math.floor(Math.log10(count)))}px`,
      }}
    >
      {count > 99 ? "99+" : count}
    </button>
  );
});

export default function MapView({
  properties,
  selectedPropertyId,
  onPropertySelect,
  onBoundsChange,
  className = "",
  defaultCenter = [-79.326917, 43.863921], // GTA area
  defaultZoom = 11,
}: MapViewProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef>(null);
  
  const [viewState, setViewState] = useState({
    longitude: defaultCenter[0],
    latitude: defaultCenter[1],
    zoom: defaultZoom,
  });
  
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [clusters, setClusters] = useState<Point[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  // Initialize Supercluster
  const supercluster = useMemo(() => {
    return new Supercluster<ClusterProperties>({
      radius: 60,
      maxZoom: 16,
      minPoints: 2,
    });
  }, []);

  // Create GeoJSON points from properties
  const points: Point[] = useMemo(() => {
    const filtered = properties.filter((p) => p.Latitude && p.Longitude);
    return filtered.map((property) => ({
      type: "Feature" as const,
      properties: {
        cluster: false,
        property,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [property.Longitude, property.Latitude] as [number, number],
      },
    }));
  }, [properties]);

  // Auto-fit map to show all properties when they change
  useEffect(() => {
    const propertiesWithCoords = properties.filter(p => p.Latitude && p.Longitude);
    
    if (propertiesWithCoords.length > 0 && mapRef.current) {
      // Calculate bounding box
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      
      propertiesWithCoords.forEach(p => {
        minLng = Math.min(minLng, p.Longitude);
        maxLng = Math.max(maxLng, p.Longitude);
        minLat = Math.min(minLat, p.Latitude);
        maxLat = Math.max(maxLat, p.Latitude);
      });
      
      // Add padding
      const lngPadding = (maxLng - minLng) * 0.2 || 0.05;
      const latPadding = (maxLat - minLat) * 0.2 || 0.05;
      
      // Fit bounds with padding
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.fitBounds(
            [[minLng - lngPadding, minLat - latPadding], [maxLng + lngPadding, maxLat + latPadding]],
            { duration: 800, padding: 60 }
          );
        }
      }, 100);
    }
  }, [properties]);

  // Load points into supercluster when properties change
  useEffect(() => {
    if (points.length > 0) {
      supercluster.load(points);
      if (bounds) {
        const zoom = Math.floor(viewState.zoom);
        const newClusters = supercluster.getClusters(bounds, zoom);
        setClusters(newClusters as Point[]);
      }
    }
  }, [points, supercluster, bounds, viewState.zoom]);

  // Update clusters when bounds change
  useEffect(() => {
    if (bounds && supercluster && points.length > 0) {
      const zoom = Math.floor(viewState.zoom);
      const newClusters = supercluster.getClusters(bounds, zoom);
      setClusters(newClusters as Point[]);
      
      if (onBoundsChange) {
        const latDelta = 180 / Math.pow(2, viewState.zoom);
        const lngDelta = 360 / Math.pow(2, viewState.zoom);
        onBoundsChange({
          north: viewState.latitude + latDelta,
          south: viewState.latitude - latDelta,
          east: viewState.longitude + lngDelta,
          west: viewState.longitude - lngDelta,
        });
      }
    }
  }, [bounds, viewState.zoom, supercluster, onBoundsChange, points.length]);

  const handleMapMove = useCallback((evt: { viewState: typeof viewState }) => {
    setViewState(evt.viewState);
  }, []);

  const handleClusterClick = useCallback((clusterId: number, longitude: number, latitude: number) => {
    const zoom = supercluster.getClusterExpansionZoom(clusterId);
    setViewState({
      longitude,
      latitude,
      zoom: Math.min(zoom, 16),
    });
  }, [supercluster]);

  const handleMarkerClick = useCallback((property: Property) => {
    setSelectedProperty(property);
    if (onPropertySelect) {
      onPropertySelect(property.ListingKey);
    }
  }, [onPropertySelect]);

  if (!mapboxToken || mapboxToken === "your-mapbox-token") {
    return (
      <div className={`flex items-center justify-center bg-muted rounded-lg ${className}`}>
        <div className="text-center p-6">
          <MapPin className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">Map not configured</p>
          <p className="text-xs text-muted-foreground mt-1">Please add your Mapbox token</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={handleMapMove}
        mapboxAccessToken={mapboxToken}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: "100%", height: "100%" }}
        onRender={(e: any) => {
          const mapBounds = e.target.getBounds();
          if (mapBounds) {
            setBounds([
              mapBounds.getWest(),
              mapBounds.getSouth(),
              mapBounds.getEast(),
              mapBounds.getNorth(),
            ]);
          }
        }}
        onClick={(e) => {
          if (!e.features || e.features.length === 0) {
            setSelectedProperty(null);
          }
        }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" />
        <GeolocateControl position="top-right" />
        
        {clusters.map((cluster, index) => {
          const [longitude, latitude] = cluster.geometry.coordinates;
          const { cluster: isCluster, point_count, cluster_id, property } = cluster.properties;

          if (isCluster) {
            return (
              <Marker
                key={`cluster-${cluster_id}`}
                longitude={longitude}
                latitude={latitude}
                anchor="center"
              >
                <ClusterMarker
                  count={point_count || 0}
                  onClick={() => handleClusterClick(cluster_id!, longitude, latitude)}
                />
              </Marker>
            );
          }

          if (property) {
            return (
              <Marker
                key={`property-${property.ListingKey}`}
                longitude={longitude}
                latitude={latitude}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleMarkerClick(property);
                }}
              >
                <PropertyMarker
                  property={property}
                  isSelected={selectedPropertyId === property.ListingKey || selectedProperty?.ListingKey === property.ListingKey}
                  onClick={() => handleMarkerClick(property)}
                />
              </Marker>
            );
          }

          return null;
        })}

        {selectedProperty && (
          <Popup
            longitude={selectedProperty.Longitude}
            latitude={selectedProperty.Latitude}
            anchor="bottom"
            onClose={() => setSelectedProperty(null)}
            closeButton={true}
            closeOnClick={false}
            offset={20}
            className="property-popup"
          >
            {/* Card Container */}
            <div className="w-80 bg-white rounded-xl shadow-2xl overflow-hidden">
              {/* Image Section */}
              <div className="relative h-44 overflow-hidden">
                {selectedProperty.photoUrl ? (
                  <img
                    src={selectedProperty.photoUrl}
                    alt={selectedProperty.UnparsedAddress}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                    <Building2 className="h-16 w-16 text-slate-300" />
                  </div>
                )}
                
                {/* Days on Market Badge */}
                {selectedProperty.DaysOnMarket && (
                  <div className="absolute top-3 left-3 px-2.5 py-1 bg-white/95 backdrop-blur-sm text-slate-700 text-xs font-semibold rounded-md shadow-sm">
                    {selectedProperty.DaysOnMarket} Days on Market
                  </div>
                )}
                
                {/* Favorite Button */}
                <button className="absolute top-3 right-3 p-2 bg-white/95 backdrop-blur-sm rounded-full shadow-sm hover:bg-white transition-colors">
                  <Heart className="h-4 w-4 text-slate-600" />
                </button>
              </div>
              
              {/* Content Section */}
              <div className="p-4">
                {/* Price */}
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-2xl font-bold text-slate-900">
                    {formatPrice(selectedProperty.ListPrice)}
                  </p>
                </div>
                
                {/* Address */}
                <p className="text-sm text-slate-700 font-medium line-clamp-1 mb-2">
                  {selectedProperty.UnparsedAddress}
                </p>
                
                {/* Property Details Row */}
                <div className="flex items-center gap-4 text-sm text-slate-500 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Bed className="h-4 w-4" />
                    <span className="font-medium">{selectedProperty.BedroomsTotal || 0}</span>
                    <span className="text-slate-400">bed</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Bath className="h-4 w-4" />
                    <span className="font-medium">{selectedProperty.BathroomsTotalInteger || 0}</span>
                    <span className="text-slate-400">bath</span>
                  </div>
                  {selectedProperty.BuildingAreaTotal && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" />
                      <span className="font-medium">{selectedProperty.BuildingAreaTotal.toLocaleString()}</span>
                      <span className="text-slate-400">sqft</span>
                    </div>
                  )}
                </div>
                
                {/* Brokerage */}
                {selectedProperty.ListOfficeName && (
                  <p className="text-xs text-slate-400 mb-3 truncate">
                    Listed by: {selectedProperty.ListOfficeName}
                  </p>
                )}
                
                {/* Action Button */}
                <a 
                  href={`/properties/${selectedProperty.ListingKey}`}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors"
                >
                  Get More Details
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </Popup>
        )}
      </Map>
      
      {/* Property count indicator */}
      <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-md z-10">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{properties.length}</span> properties
        </p>
      </div>
    </div>
  );
}
