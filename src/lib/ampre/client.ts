// Ampre API Client for interacting with the Ampre Web API

import type { Property, PropertySearchParams, AmpreApiResponse, Media, MediaSearchParams, Field, FieldSearchParams, Lookup, LookupSearchParams } from './types';

const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';

export class AmpreApiClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), {
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
   * Fetch a single property by ListingKey
   */
  async getProperty(listingKey: string): Promise<Property> {
    return this.request<Property>(`/Property('${listingKey}')`);
  }

  /**
   * Get all properties with optional filtering
   * @param params - OData query parameters ($top, $skip, $filter, $orderby, $select)
   */
  async getProperties(params?: PropertySearchParams): Promise<AmpreApiResponse<Property>> {
    return this.request<AmpreApiResponse<Property>>('/Property', params as Record<string, string>);
  }

  /**
   * Search properties by city (active listings only)
   */
  async searchByCity(city: string, options?: Partial<PropertySearchParams>): Promise<AmpreApiResponse<Property>> {
    const params: Record<string, string> = {
      $filter: `contains(City,'${city}') and StandardStatus eq 'Active'`,
      ...options as Record<string, string>,
    };
    return this.request<AmpreApiResponse<Property>>('/Property', params);
  }

  /**
   * Search properties by price range (active listings only)
   */
  async searchByPriceRange(minPrice?: number, maxPrice?: number, options?: Partial<PropertySearchParams>): Promise<AmpreApiResponse<Property>> {
    const conditions: string[] = ["StandardStatus eq 'Active'"];
    
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
    return this.request<AmpreApiResponse<Property>>('/Property', params);
  }

  /**
   * Get active listings only
   */
  async getActiveListings(options?: Partial<PropertySearchParams>): Promise<AmpreApiResponse<Property>> {
    const params: Record<string, string> = {
      $filter: "StandardStatus eq 'Active'",
      ...options as Record<string, string>,
    };
    return this.request<AmpreApiResponse<Property>>('/Property', params);
  }

  /**
   * Get property count
   */
  async getPropertyCount(): Promise<number> {
    const result = await this.request<{ '@odata.count': number }>('/Property', { $count: 'true', $top: '0' });
    return result['@odata.count'] || 0;
  }

  // ==================== MEDIA METHODS ====================

  /**
   * Fetch a single Media record by MediaKey
   */
  async getMedia(mediaKey: string): Promise<Media> {
    return this.request<Media>(`/Media('${mediaKey}')`);
  }

  /**
   * Get all media with optional filtering
   * @param params - OData query parameters ($top, $skip, $filter, $orderby, $select)
   */
  async getMediaList(params?: MediaSearchParams): Promise<AmpreApiResponse<Media>> {
    return this.request<AmpreApiResponse<Media>>('/Media', params as Record<string, string>);
  }

  /**
   * Get media for a specific Property by its ListingKey
   * @param listingKey - The ListingKey of the property
   * @param imageSize - Optional image size filter (e.g., 'Large')
   */
  async getPropertyMedia(listingKey: string, imageSize?: string): Promise<AmpreApiResponse<Media>> {
    const conditions: string[] = [`ResourceName eq 'Property'`, `ResourceRecordKey eq '${listingKey}'`];
    
    if (imageSize) {
      conditions.push(`ImageSizeDescription eq '${imageSize}'`);
    }
    
    const params: Record<string, string> = {
      $filter: conditions.join(' and '),
      $orderby: 'ModificationTimestamp,MediaKey',
    };
    return this.request<AmpreApiResponse<Media>>('/Media', params);
  }

  /**
   * Get all media (all sizes) for a specific Property by its ListingKey
   * Use this when you need all photos regardless of size
   */
  async getAllPropertyMedia(listingKey: string): Promise<AmpreApiResponse<Media>> {
    const params: Record<string, string> = {
      $filter: `ResourceName eq 'Property' and ResourceRecordKey eq '${listingKey}'`,
      $orderby: 'ModificationTimestamp,MediaKey',
    };
    return this.request<AmpreApiResponse<Media>>('/Media', params);
  }

  /**
   * Get media for a specific Office by its OfficeKey
   * @param officeKey - The OfficeKey (typically stored as ResourceRecordKey)
   */
  async getOfficeMedia(officeKey: string): Promise<AmpreApiResponse<Media>> {
    const params: Record<string, string> = {
      $filter: `ResourceName eq 'Office' and ResourceRecordKey eq '${officeKey}'`,
      $orderby: 'ModificationTimestamp,MediaKey',
    };
    return this.request<AmpreApiResponse<Media>>('/Media', params);
  }

  /**
   * Get media for a specific Member by its MemberKey
   * @param memberKey - The MemberKey (typically stored as ResourceRecordKey)
   */
  async getMemberMedia(memberKey: string): Promise<AmpreApiResponse<Media>> {
    const params: Record<string, string> = {
      $filter: `ResourceName eq 'Member' and ResourceRecordKey eq '${memberKey}'`,
      $orderby: 'ModificationTimestamp,MediaKey',
    };
    return this.request<AmpreApiResponse<Media>>('/Media', params);
  }

  /**
   * Get recently modified media records for a specific resource type
   * @param resourceName - 'Property', 'Office', or 'Member'
   * @param since - ISO timestamp to filter by ModificationTimestamp
   * @param imageSize - Optional image size filter
   */
  async getRecentlyModifiedMedia(resourceName: string, since: string, imageSize?: string): Promise<AmpreApiResponse<Media>> {
    const conditions: string[] = [
      `ResourceName eq '${resourceName}'`,
      `ModificationTimestamp ge ${since}`,
    ];
    
    if (imageSize) {
      conditions.push(`ImageSizeDescription eq '${imageSize}'`);
    }
    
    const params: Record<string, string> = {
      $filter: conditions.join(' and '),
      $orderby: 'ModificationTimestamp,MediaKey',
    };
    return this.request<AmpreApiResponse<Media>>('/Media', params);
  }

  /**
   * Get the logo for an Office (convenience method)
   * Uses PhotosChangeTimestamp pattern for detecting changes
   */
  async getOfficeLogo(officeKey: string): Promise<AmpreApiResponse<Media>> {
    return this.getOfficeMedia(officeKey);
  }

  /**
   * Get member photos/headshots (convenience method)
   * Uses PhotosChangeTimestamp pattern for detecting changes
   */
  async getMemberPhoto(memberKey: string): Promise<AmpreApiResponse<Media>> {
    return this.getMemberMedia(memberKey);
  }

  /**
   * Get media count
   */
  async getMediaCount(): Promise<number> {
    const result = await this.request<{ '@odata.count': number }>('/Media', { $count: 'true', $top: '0' });
    return result['@odata.count'] || 0;
  }

  // ==================== FIELD METHODS ====================

  /**
   * Fetch a single Field record by FieldName
   */
  async getField(resourceName: string, fieldName: string): Promise<Field> {
    return this.request<Field>(`/Field('${resourceName}/${fieldName}')`);
  }

  /**
   * Get all fields with optional filtering
   * @param params - OData query parameters ($top, $skip, $filter, $orderby, $select)
   */
  async getFields(params?: FieldSearchParams): Promise<AmpreApiResponse<Field>> {
    return this.request<AmpreApiResponse<Field>>('/Field', params as Record<string, string>);
  }

  /**
   * Get fields for a specific resource (e.g., 'Property')
   * @param resourceName - The resource name (e.g., 'Property')
   */
  async getFieldsByResource(resourceName: string, options?: Partial<FieldSearchParams>): Promise<AmpreApiResponse<Field>> {
    const params: Record<string, string> = {
      $filter: `ResourceName eq '${resourceName}'`,
      ...options as Record<string, string>,
    };
    return this.request<AmpreApiResponse<Field>>('/Field', params);
  }

  /**
   * Get searchable fields for a resource
   */
  async getSearchableFields(resourceName: string): Promise<AmpreApiResponse<Field>> {
    const params: Record<string, string> = {
      $filter: `ResourceName eq '${resourceName}' and IsSearchable eq true`,
    };
    return this.request<AmpreApiResponse<Field>>('/Field', params);
  }

  // ==================== LOOKUP METHODS ====================

  /**
   * Fetch a single Lookup record
   */
  async getLookup(lookupName: string, lookupValue: string): Promise<Lookup> {
    return this.request<Lookup>(`/Lookup('${lookupName}/${lookupValue}')`);
  }

  /**
   * Get all lookups with optional filtering
   * @param params - OData query parameters ($top, $skip, $filter, $orderby, $select)
   */
  async getLookups(params?: LookupSearchParams): Promise<AmpreApiResponse<Lookup>> {
    return this.request<AmpreApiResponse<Lookup>>('/Lookup', params as Record<string, string>);
  }

  /**
   * Get lookups by LookupName (e.g., 'PropertyType')
   * @param lookupName - The lookup name (e.g., 'PropertyType', 'City', 'StandardStatus')
   */
  async getLookupsByName(lookupName: string, options?: Partial<LookupSearchParams>): Promise<AmpreApiResponse<Lookup>> {
    const params: Record<string, string> = {
      $filter: `LookupName eq '${lookupName}'`,
      $orderby: 'DisplayOrder,LookupValue',
      ...options as Record<string, string>,
    };
    return this.request<AmpreApiResponse<Lookup>>('/Lookup', params);
  }

  /**
   * Get property type lookups (convenience method)
   */
  async getPropertyTypes(): Promise<AmpreApiResponse<Lookup>> {
    return this.getLookupsByName('PropertyType');
  }

  /**
   * Get standard status lookups (convenience method)
   */
  async getStandardStatuses(): Promise<AmpreApiResponse<Lookup>> {
    return this.getLookupsByName('StandardStatus');
  }

  /**
   * Get city lookups (convenience method)
   */
  async getCities(): Promise<AmpreApiResponse<Lookup>> {
    return this.getLookupsByName('City');
  }
}

/**
 * Create an Ampre API client with an access token
 * @param accessToken - Bearer token for authentication
 */
export function createAmpreClient(accessToken: string): AmpreApiClient {
  return new AmpreApiClient(accessToken);
}

/**
 * Get properties with a token from environment
 * Falls back to using AMPRE_ACCESS_TOKEN from env
 */
export async function getPropertiesFromEnv(params?: PropertySearchParams): Promise<AmpreApiResponse<Property>> {
  const token = process.env.AMPRE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('AMPRE_ACCESS_TOKEN environment variable is not set');
  }
  const client = createAmpreClient(token);
  return client.getProperties(params);
}

/**
 * Test the API connection
 * Returns true if connection is successful, throws error otherwise
 */
export async function testConnection(accessToken?: string): Promise<{ success: boolean; count: number }> {
  const token = accessToken || process.env.AMPRE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('No access token provided');
  }
  
  const client = createAmpreClient(token);
  try {
    const count = await client.getPropertyCount();
    console.log('✓ API Connected! Total properties:', count);
    return { success: true, count };
  } catch (error) {
    throw new Error(`API Connection Failed: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure your access token is valid.`);
  }
}