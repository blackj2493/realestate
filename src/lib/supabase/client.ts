/**
 * Supabase Client Library
 * 
 * Provides two client instances:
 * - Server-side (backend): Uses SERVICE_ROLE_KEY for privileged operations
 * - Client-side (frontend): Uses ANON_KEY for authenticated user operations
 * 
 * Background workers (ETL) must ALWAYS use the service role client.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivixhnwzfrdkiq.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Singleton instances
let serverClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

/**
 * Server-side client for Next.js API routes
 * Uses ANON_KEY - respects Row Level Security policies
 */
export function getServerClient(): SupabaseClient {
  if (!serverClient) {
    if (!SUPABASE_ANON_KEY) {
      throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
    }
    serverClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return serverClient;
}

/**
 * Service role client for ETL workers and background jobs
 * Uses SERVICE_ROLE_KEY - bypasses Row Level Security
 * 
 * WARNING: Only use this in secure server-side contexts (API routes, workers)
 * Never expose this client to the frontend
 */
export function getServiceRoleClient(): SupabaseClient {
  if (!adminClient) {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    }
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return adminClient;
}

/**
 * Type definitions for listings table
 */
export interface ListingRecord {
  id: string;
  listing_key: string;  // Maps to API's ListingKey (unique)
  full_payload: Record<string, unknown>;  // Complete raw API response
  media_urls: string[];  // Extracted for quick access
  derived_metrics: {
    isDistressed?: boolean;
    targetGrossYield?: number;
    hasSecondarySuitePotential?: boolean;
    calculatedDOM?: number;
  };
  needs_geocoding: boolean;  // True if coordinate lookup failed
  city: string | null;
  property_sub_type: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

/**
 * Insert or update a listing (upsert by listing_key)
 */
export async function upsertListing(
  client: SupabaseClient,
  listing: {
    listingKey: string;
    fullPayload: Record<string, unknown>;
    mediaUrls: string[];
    derivedMetrics: ListingRecord['derived_metrics'];
    needsGeocoding: boolean;
    city?: string;
    propertySubType?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data, error } = await client
    .from('listings')
    .upsert(
      {
        listing_key: listing.listingKey,
        full_payload: listing.fullPayload,
        media_urls: listing.mediaUrls,
        derived_metrics: listing.derivedMetrics,
        needs_geocoding: listing.needsGeocoding,
        city: listing.city,
        property_sub_type: listing.propertySubType,
        updated_at: new Date().toISOString(),
        synced_at: new Date().toISOString()
      },
      { 
        onConflict: 'listing_key',
        ignoreDuplicates: false
      }
    )
    .select('id')
    .single();
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return { success: true, id: data?.id };
}

/**
 * Fetch a single listing by its API ListingKey
 */
export async function getListingByKey(
  client: SupabaseClient,
  listingKey: string
): Promise<ListingRecord | null> {
  const { data, error } = await client
    .from('listings')
    .select('*')
    .eq('listing_key', listingKey)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;  // Not found
    }
    throw error;
  }
  
  return data as ListingRecord;
}

/**
 * Batch upsert listings (for ETL delta sync)
 */
export async function batchUpsertListings(
  client: SupabaseClient,
  listings: Array<{
    listingKey: string;
    fullPayload: Record<string, unknown>;
    mediaUrls: string[];
    derivedMetrics: ListingRecord['derived_metrics'];
    needsGeocoding: boolean;
    city?: string;
    propertySubType?: string;
  }>
): Promise<{ success: number; failed: number; errors: string[] }> {
  const records = listings.map(listing => ({
    listing_key: listing.listingKey,
    full_payload: listing.fullPayload,
    media_urls: listing.mediaUrls,
    derived_metrics: listing.derivedMetrics,
    needs_geocoding: listing.needsGeocoding,
    city: listing.city,
    property_sub_type: listing.propertySubType,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString()
  }));
  
  const { data, error } = await client
    .from('listings')
    .upsert(records, { onConflict: 'listing_key', ignoreDuplicates: false });
  
  if (error) {
    return { success: 0, failed: listings.length, errors: [error.message] };
  }
  
  return { 
    success: data?.length || listings.length, 
    failed: 0, 
    errors: [] 
  };
}

/**
 * Get listings with coordinates (for Typesense sync)
 */
export async function getUnsyncedListings(
  client: SupabaseClient,
  limit = 1000
): Promise<ListingRecord[]> {
  const { data, error } = await client
    .from('listings')
    .select('*')
    .eq('needs_geocoding', false)
    .order('synced_at', { ascending: true })
    .limit(limit);
  
  if (error) throw error;
  return data as ListingRecord[];
}

/**
 * Mark listing as needing geocoding (for batch correction)
 */
export async function markNeedsGeocoding(
  client: SupabaseClient,
  listingKey: string
): Promise<void> {
  await client
    .from('listings')
    .update({ needs_geocoding: true })
    .eq('listing_key', listingKey);
}