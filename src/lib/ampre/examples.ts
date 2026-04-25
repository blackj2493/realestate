// Example usage utilities for Ampre API

import { createAmpreClient, getPropertiesFromEnv } from './client';
import type { PropertySearchParams } from './types';

/**
 * Example 1: Fetch first 10 properties using environment variable
 */
export async function exampleFetchFirst10(): Promise<void> {
  try {
    const result = await getPropertiesFromEnv({ $top: 10 });
    console.log('Properties:', result.value);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 2: Fetch properties with explicit token
 */
export async function exampleWithToken(accessToken: string): Promise<void> {
  const client = createAmpreClient(accessToken);
  const result = await client.getProperties({ $top: 5 });
  console.log('Properties:', result.value);
}

/**
 * Example 3: Search by city
 */
export async function exampleSearchByCity(city: string, accessToken: string): Promise<void> {
  const client = createAmpreClient(accessToken);
  const result = await client.searchByCity(city, { $top: 20 });
  console.log(`Properties in ${city}:`, result.value);
}

/**
 * Example 4: Search by price range
 */
export async function exampleSearchByPrice(
  minPrice: number,
  maxPrice: number,
  accessToken: string
): Promise<void> {
  const client = createAmpreClient(accessToken);
  const result = await client.searchByPriceRange(minPrice, maxPrice, { $top: 20 });
  console.log(`Properties between $${minPrice} and $${maxPrice}:`, result.value);
}

/**
 * Example 5: Paginated search
 */
export async function examplePaginatedSearch(
  page: number,
  pageSize: number,
  accessToken: string
): Promise<void> {
  const client = createAmpreClient(accessToken);
  const params: PropertySearchParams = {
    $top: pageSize,
    $skip: (page - 1) * pageSize,
  };
  const result = await client.getProperties(params);
  console.log(`Page ${page} (${result.value.length} items):`, result.value);
}

// curl example:
// curl -H 'Authorization: Bearer your-access-token-goes-here' \
// -H 'Accept: application/json' \
// 'https://query.ampre.ca/odata/Property?$top=1'