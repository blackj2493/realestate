// ProptX VOW (Virtual Office Website) API Client
// Uses Ampre's OData endpoint with ProptX tokens

import type {
  Property,
  Media,
  OpenHouse,
  PropertyRoom,
  PropertySearchParams,
  PropertyResponse,
  MediaResponse,
  OpenHouseResponse,
  PropertyRoomResponse,
} from './types';

// Ampre's OData endpoint (same as Ampre API)
const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';

export type TokenType = 'IDX' | 'DLA' | 'VOW';

export class ProptXClient {
  private accessToken: string;
  private tokenType: TokenType;

  constructor(accessToken: string, tokenType: TokenType = 'VOW') {
    this.accessToken = accessToken;
    this.tokenType = tokenType;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    // Build URL manually to avoid double-encoding of OData parameters
    let urlString = `${API_BASE_URL}${endpoint}`;
    
    if (params) {
      const queryParts: string[] = [];
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParts.push(`${key}=${encodeURIComponent(value)}`);
        }
      });
      if (queryParts.length > 0) {
        urlString += '?' + queryParts.join('&');
      }
    }

    const response = await fetch(urlString, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get the token type being used
   */
  getTokenType(): TokenType {
    return this.tokenType;
  }

  // ============ Property Endpoints ============

  /**
   * Get all properties with optional filtering
   */
  async getProperties(params?: PropertySearchParams): Promise<PropertyResponse> {
    return this.request<PropertyResponse>('/Property', params as Record<string, string>);
  }

  /**
   * Get a single property by ListingKey
   */
  async getProperty(listingKey: string): Promise<Property> {
    return this.request<Property>(`/Property('${listingKey}')`);
  }

  /**
   * Get active listings only
   */
  async getActiveListings(options?: PropertySearchParams): Promise<PropertyResponse> {
    const params: Record<string, string> = {
      $filter: "StandardStatus eq 'Active'",
      ...options as Record<string, string>,
    };
    return this.request<PropertyResponse>('/Property', params);
  }

  /**
   * Search properties by city
   */
  async searchByCity(city: string, options?: PropertySearchParams): Promise<PropertyResponse> {
    const params: Record<string, string> = {
      $filter: `contains(City,'${city}')`,
      ...options as Record<string, string>,
    };
    return this.request<PropertyResponse>('/Property', params);
  }

  /**
   * Search properties by price range
   */
  async searchByPriceRange(minPrice?: number, maxPrice?: number, options?: PropertySearchParams): Promise<PropertyResponse> {
    const conditions: string[] = [];
    
    if (minPrice !== undefined && maxPrice !== undefined) {
      conditions.push(`ListPrice ge ${minPrice} and ListPrice le ${maxPrice}`);
    } else if (minPrice !== undefined) {
      conditions.push(`ListPrice ge ${minPrice}`);
    } else if (maxPrice !== undefined) {
      conditions.push(`ListPrice le ${maxPrice}`);
    }
    
    const params: Record<string, string> = {
      $filter: conditions.join(' and '),
      ...options as Record<string, string>,
    };
    return this.request<PropertyResponse>('/Property', params);
  }

  /**
   * Search by property type (Residential, Commercial, etc.)
   */
  async searchByType(propertyType: string, options?: PropertySearchParams): Promise<PropertyResponse> {
    const params: Record<string, string> = {
      $filter: `PropertyType eq '${propertyType}'`,
      ...options as Record<string, string>,
    };
    return this.request<PropertyResponse>('/Property', params);
  }

  /**
   * Search by bedrooms minimum
   */
  async searchByBedrooms(minBedrooms: number, options?: PropertySearchParams): Promise<PropertyResponse> {
    const params: Record<string, string> = {
      $filter: `BedroomsTotal ge ${minBedrooms}`,
      ...options as Record<string, string>,
    };
    return this.request<PropertyResponse>('/Property', params);
  }

  // ============ Media Endpoints ============

  /**
   * Get media for a specific listing
   * Note: The ResourceName field in Media is boolean, not string, so we only filter by ResourceRecordKey
   */
  async getMedia(listingKey: string, options?: PropertySearchParams): Promise<MediaResponse> {
    const params: Record<string, string> = {
      $filter: `ResourceRecordKey eq '${listingKey}'`,
      ...options as Record<string, string>,
    };
    return this.request<MediaResponse>('/Media', params);
  }

  /**
   * Get all media (may be limited based on token type)
   */
  async getAllMedia(options?: PropertySearchParams): Promise<MediaResponse> {
    return this.request<MediaResponse>('/Media', options as Record<string, string>);
  }

  /**
   * Get media for multiple listings with a custom filter
   * @param filter - OData filter string (e.g., "ResourceRecordKey eq 'key1' or ResourceRecordKey eq 'key2'")
   */
  async getMediaBatch(filter: string): Promise<MediaResponse> {
    const params: Record<string, string> = {
      $filter: filter,
    };
    return this.request<MediaResponse>('/Media', params);
  }

  /**
   * Get media for multiple listings by their keys
   * @param listingKeys - Array of listing keys
   */
  async getMediaForListings(listingKeys: string[]): Promise<MediaResponse> {
    if (listingKeys.length === 0) {
      return { value: [] };
    }
    const filter = listingKeys.map(key => `ResourceRecordKey eq '${key}'`).join(' or ');
    return this.getMediaBatch(filter);
  }

  // ============ Open House Endpoints ============

  /**
   * Get upcoming open houses
   */
  async getOpenHouses(options?: PropertySearchParams): Promise<OpenHouseResponse> {
    return this.request<OpenHouseResponse>('/OpenHouse', options as Record<string, string>);
  }

  /**
   * Get open houses for a specific listing
   */
  async getOpenHousesForListing(listingKey: string): Promise<OpenHouseResponse> {
    const params: Record<string, string> = {
      $filter: `ListingKey eq '${listingKey}'`,
    };
    return this.request<OpenHouseResponse>('/OpenHouse', params);
  }

  // ============ Property Rooms Endpoints ============

  /**
   * Get rooms for a specific listing
   */
  async getRooms(listingKey: string): Promise<PropertyRoomResponse> {
    const params: Record<string, string> = {
      $filter: `ListingKey eq '${listingKey}'`,
      $orderby: 'Order asc',
    };
    return this.request<PropertyRoomResponse>('/PropertyRooms', params);
  }

  // ============ Utility Methods ============

  /**
   * Get property count
   */
  async getPropertyCount(): Promise<number> {
    const result = await this.request<{ '@odata.count': number }>('/Property', { $count: 'true', $top: '0' });
    return result['@odata.count'] || 0;
  }
}

/**
 * Create a ProptX client with IDX token
 */
export function createIdxClient(accessToken: string): ProptXClient {
  return new ProptXClient(accessToken, 'IDX');
}

/**
 * Create a ProptX client with DLA token
 */
export function createDlaClient(accessToken: string): ProptXClient {
  return new ProptXClient(accessToken, 'DLA');
}

/**
 * Create a ProptX client with VOW token
 */
export function createVowClient(accessToken: string): ProptXClient {
  return new ProptXClient(accessToken, 'VOW');
}

/**
 * Get a client using environment variables
 */
export function createClientFromEnv(tokenType: TokenType = 'VOW'): ProptXClient {
  let token: string | undefined;
  
  switch (tokenType) {
    case 'IDX':
      // IDX with VOW fallback - IDX is more reliable right now
      token = process.env.PROPTX_IDX_TOKEN || process.env.PROPTX_VOW_TOKEN;
      break;
    case 'DLA':
      token = process.env.PROPTX_DLA_TOKEN || process.env.PROPTX_IDX_TOKEN;
      break;
    case 'VOW':
      // VOW with IDX fallback - in case VOW is still having issues
      token = process.env.PROPTX_VOW_TOKEN || process.env.PROPTX_IDX_TOKEN;
      break;
  }
  
  if (!token) {
    throw new Error(`${tokenType} token not found in environment variables`);
  }
  
  return new ProptXClient(token, tokenType);
}

/**
 * Test API connection with any available token
 */
export async function testConnection(tokenType?: TokenType): Promise<{ success: boolean; count: number; tokenType: string }> {
  // Try VOW first, then IDX, then DLA
  const tokenTypes: TokenType[] = tokenType ? [tokenType] : ['VOW', 'IDX', 'DLA'];
  
  for (const type of tokenTypes) {
    try {
      const token = type === 'IDX' ? process.env.PROPTX_IDX_TOKEN 
                 : type === 'DLA' ? process.env.PROPTX_DLA_TOKEN 
                 : process.env.PROPTX_VOW_TOKEN;
      
      if (!token) continue;
      
      const client = new ProptXClient(token, type);
      const count = await client.getPropertyCount();
      console.log(`✓ ${type} API Connected! Total properties:`, count);
      return { success: true, count, tokenType: type };
    } catch (error) {
      console.log(`✗ ${type} failed:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  throw new Error('No working API token found. Please check your environment variables.');
}