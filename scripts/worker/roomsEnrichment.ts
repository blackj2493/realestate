/**
 * /PropertyRooms enrichment — shared between the nightly ingester (per-batch
 * attachment onto active listings) and the one-time backfill (jsonb_set into
 * existing rows). Per-room dimensions live in a SEPARATE RESO resource
 * (/PropertyRooms), NOT in the /Property payload.
 *
 * Self-contained on purpose: the backfill script must NOT import scripts/worker/
 * sync.ts (which hard-throws on TYPESENSE_ADMIN_API_KEY at module load), so this
 * module brings its own minimal sleep + fetchWithRetry rather than reaching back
 * into ingester.ts. Deterministic, no AI (CLAUDE.md §4) — rooms are stored verbatim.
 */

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];

export const ROOMS_CHUNK_SIZE = 25;        // listing keys per /PropertyRooms request (short URLs, modest responses)
export const ROOMS_REQUEST_DELAY_MS = 300; // polite delay between room requests

export interface StoredRoom {
  RoomKey?: string;
  RoomType?: string | string[];
  RoomLevel?: string | string[];
  RoomLength?: number;
  RoomWidth?: number;
  /**
   * The unit RoomLength/RoomWidth are expressed in, as the feed declares it
   * ("Meters" / "Feet"). Sparsely populated — roughly a fifth of rooms carry it —
   * but authoritative where present, and guessing wrong is a 10.76x error in the
   * AVM's living-area maths. Previously dropped here, which is the only reason
   * livingArea.ts had to infer the unit from magnitude at all.
   */
  RoomLengthWidthUnits?: string | null;
  RoomDimensions?: string | null;
  RoomFeatures?: string[];
}

interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<FetchResult<T>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...options.headers, Accept: 'application/json' },
      });

      if (response.status >= 500 && response.status < 600) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await sleep(retryAfter);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
          statusCode: response.status,
        };
      }
      return { success: true, data };
    } catch (err: unknown) {
      lastError = err as Error;
      if (attempt < retries) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await sleep(retryAfter);
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`,
  };
}

// Trim each /PropertyRooms record to the fields the visualizer consumes (matches
// getListingDetail's mapping + the VOW example payload's `rooms` shape).
export function toStoredRoom(r: any): StoredRoom {
  return {
    RoomKey: r.RoomKey,
    RoomType: r.RoomType,
    RoomLevel: r.RoomLevel,
    RoomLength: r.RoomLength,
    RoomWidth: r.RoomWidth,
    RoomLengthWidthUnits: r.RoomLengthWidthUnits ?? null,
    RoomDimensions: r.RoomDimensions ?? null,
    RoomFeatures: r.RoomFeatures,
  };
}

/**
 * Fetches /PropertyRooms for a set of ListingKeys (IDX token), OR-batched into
 * chunks with nextLink pagination. Returns Map<ListingKey, StoredRoom[]> sorted by
 * Order. Best-effort: a failed chunk is skipped (those listings sync without rooms;
 * the detail page's live fallback still covers them).
 *
 * Token is read from PROPTX_IDX_TOKEN at call time so a missing env var fails
 * gracefully (returns empty map) instead of throwing at module load.
 */
export async function fetchRoomsForKeys(keys: string[]): Promise<Map<string, StoredRoom[]>> {
  const grouped = new Map<string, StoredRoom[]>();
  const token = (process.env.PROPTX_IDX_TOKEN || '').trim();
  if (!token || keys.length === 0) return grouped;

  // Accumulate raw rooms (with Order) so we can sort per listing after grouping.
  const rawByKey = new Map<string, any[]>();

  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += ROOMS_CHUNK_SIZE) {
    chunks.push(keys.slice(i, i + ROOMS_CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    const orFilter = `(${chunk.map((k) => `ListingKey eq '${k}'`).join(' or ')})`;
    let url: string | null =
      `${API_BASE_URL}/PropertyRooms?$filter=${encodeURIComponent(orFilter)}&$orderby=ListingKey,Order&$top=100&$count=true`;

    // Follow @odata.nextLink until the chunk's rooms are exhausted (a 25-listing
    // chunk can exceed the 100-record page cap).
    while (url) {
      const result: FetchResult<any> = await fetchWithRetry<any>(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!result.success || !result.data) {
        console.warn(`   ⚠️  Rooms chunk fetch failed (non-fatal): ${result.error}`);
        break; // skip remaining pages for this chunk
      }
      const rooms: any[] = result.data.value || [];
      for (const room of rooms) {
        const lk = room.ListingKey;
        if (!lk) continue;
        const arr = rawByKey.get(lk);
        if (arr) arr.push(room);
        else rawByKey.set(lk, [room]);
      }
      url = result.data['@odata.nextLink'] || null;
      await sleep(ROOMS_REQUEST_DELAY_MS);
    }
  }

  for (const [lk, rooms] of rawByKey) {
    rooms.sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
    grouped.set(lk, rooms.map(toStoredRoom));
  }
  return grouped;
}
