"use client";

import { useState, useEffect, useCallback } from "react";

export interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  error: string | null;
  loading: boolean;
  denied: boolean;
}

// Default to Downtown Toronto (Yonge & Dundas area) - HouseSigma's primary market
const DEFAULT_LOCATION = {
  latitude: 43.6561,
  longitude: -79.3802,
  city: "Toronto",
  province: "ON",
  postalCode: "M5B",
};

const CACHE_KEY = "pureproperty_location";
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

interface CachedLocation {
  latitude: number;
  longitude: number;
  city: string;
  province: string;
  postalCode: string | null;
  timestamp: number;
}

function getCachedLocation(): CachedLocation | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const data: CachedLocation = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is still valid (less than 12 hours old)
    if (now - data.timestamp < CACHE_DURATION) {
      return data;
    }
    
    // Cache expired, remove it
    localStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function setCachedLocation(location: Omit<CachedLocation, "timestamp">): void {
  try {
    const data: CachedLocation = {
      ...location,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage might be unavailable (private browsing, etc.)
  }
}

export function useGeolocation(options?: PositionOptions) {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    city: null,
    province: null,
    postalCode: null,
    error: null,
    loading: true,
    denied: false,
  });

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    try {
      // Using a free reverse geocoding service with 2 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=en`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      const city = 
        data.address?.city || 
        data.address?.town || 
        data.address?.municipality || 
        data.address?.county ||
        "Unknown";
      
      const province = 
        data.address?.state || 
        data.address?.province ||
        "ON";

      // Extract postal code (first 3 characters for Canadian postal codes)
      // Postal codes in the API response are typically in format like "M5V 2H1"
      const postcode = data.address?.postcode || null;
      // Extract first 3 chars/numbers (e.g., "M5V" from "M5V 2H1")
      const postalCodePrefix = postcode ? postcode.replace(/\s/g, '').substring(0, 3).toUpperCase() : null;

      return { city, province, postalCode: postalCodePrefix };
    } catch (error) {
      console.error("Reverse geocoding failed:", error);
      return { city: "Unknown", province: "ON", postalCode: null };
    }
  }, []);

  const getLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setState((prev) => ({
        ...prev,
        error: "Geolocation is not supported by your browser",
        loading: false,
        ...DEFAULT_LOCATION,
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 3000, // Fall back to default location after 3 seconds
          maximumAge: 300000, // 5 minutes cache
          ...options,
        });
      });

      const { latitude, longitude } = position.coords;
      
      // Race reverse geocode against 2 second timeout - fall back to Toronto if slow
      const geoResult = await Promise.race([
        reverseGeocode(latitude, longitude),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]).catch(() => null);
      
      const city = geoResult?.city || "Toronto";
      const province = geoResult?.province || "ON";
      const postalCode = geoResult?.postalCode || null;

      // Cache the successful location
      setCachedLocation({ latitude, longitude, city, province, postalCode });

      setState({
        latitude,
        longitude,
        city,
        province,
        postalCode,
        error: null,
        loading: false,
        denied: false,
      });
    } catch (error) {
      const geolocationError = error as GeolocationPositionError;
      
      if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
        setState({
          ...DEFAULT_LOCATION,
          error: "Location access denied. Showing properties in Toronto area.",
          loading: false,
          denied: true,
        });
      } else if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
        setState({
          ...DEFAULT_LOCATION,
          error: "Location information unavailable. Showing properties in Toronto area.",
          loading: false,
          denied: false,
        });
      } else if (geolocationError.code === geolocationError.TIMEOUT) {
        setState({
          ...DEFAULT_LOCATION,
          error: "Location request timed out. Showing properties in Toronto area.",
          loading: false,
          denied: false,
        });
      } else {
        setState({
          ...DEFAULT_LOCATION,
          error: "Unable to retrieve your location. Showing properties in Toronto area.",
          loading: false,
          denied: false,
        });
      }
    }
  }, [options, reverseGeocode]);

  useEffect(() => {
    // Check for cached location first
    const cached = getCachedLocation();
    if (cached) {
      setState({
        latitude: cached.latitude,
        longitude: cached.longitude,
        city: cached.city,
        province: cached.province,
        postalCode: cached.postalCode,
        error: null,
        loading: false,
        denied: false,
      });
      return;
    }
    
    // No valid cache, try to get current location
    getLocation();
  }, [getLocation]);

  const refresh = useCallback(() => {
    // Clear cache and force fresh geolocation
    localStorage.removeItem(CACHE_KEY);
    setState((prev) => ({ ...prev, loading: true }));
    getLocation();
  }, [getLocation]);

  return { ...state, refresh };
}

// Helper to calculate distance between two coordinates (Haversine formula)
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get location display text
export function getLocationDisplay(state: GeolocationState): string {
  if (state.loading) return "Detecting location...";
  if (state.city && state.province) return `${state.city}, ${state.province}`;
  return "Toronto, ON";
}
