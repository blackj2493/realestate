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
import { makeTimeoutFetch } from './timeoutFetch';

// Environment variables (sanitized to strip invisible characters)
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivilxhnwzfrdkiq.supabase.co').trim();
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// Bounded request timeout so a dead/unreachable origin (e.g. Cloudflare 522 when the
// Supabase compute is Unhealthy) fails fast and retryable instead of hanging forever —
// native fetch ships with NO timeout. Override via SUPABASE_FETCH_TIMEOUT_MS if needed.
const _supabaseFetchTimeout = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS);
const SUPABASE_FETCH_TIMEOUT_MS =
  Number.isFinite(_supabaseFetchTimeout) && _supabaseFetchTimeout > 0 ? _supabaseFetchTimeout : 30000;
// Wrap Node's native fetch (undici on Node 18+, the browser's fetch client-side) — NOT
// cross-fetch. cross-fetch delegates to node-fetch, which throws
// `FetchError: Invalid response body … Premature close` when an upstream truncates the
// REST response body mid-stream (observed on GitHub Actions' egress to Supabase: Supabase
// logs a 200 but the runner never receives the full body). That killed the daily ETL on
// its very first sync_state read, before any listing was processed. undici tolerates that
// path and is the fetch supabase-js uses by default. Bound to globalThis so the bare call
// inside makeTimeoutFetch keeps the correct receiver.
const timeoutFetch = makeTimeoutFetch(globalThis.fetch.bind(globalThis), SUPABASE_FETCH_TIMEOUT_MS);

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
      },
      global: {
        fetch: timeoutFetch // <-- bounded-timeout fetch (native fetch has none)
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
      },
      global: {
        fetch: timeoutFetch // <-- bounded-timeout fetch (native fetch has none)
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
    success: (data as unknown[] | null)?.length ?? listings.length, 
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