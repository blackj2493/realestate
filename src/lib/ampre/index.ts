// Ampre API Integration
// Documentation: https://developer.ampre.ca/docs/getting-started
// Endpoint: https://query.ampre.ca/odata/

export { AmpreApiClient, createAmpreClient, getPropertiesFromEnv, testConnection } from './client';
export type { Property, PropertySearchParams, AmpreApiResponse, AmpreError, Media, MediaSearchParams, Field, FieldSearchParams, Lookup, LookupSearchParams } from './types';

// Example usage:
//
// import { createAmpreClient, getPropertiesFromEnv, testConnection } from '@/lib/ampre';
// 
// // Test connection
// const { success, count } = await testConnection();
//
// // Fetch properties from environment token
// const result = await getPropertiesFromEnv({ $top: 10 });
// console.log(result.value);
// 
// // Or with explicit token
// const client = createAmpreClient('your-access-token');
// const properties = await client.getProperties({ $top: 10 });
// const activeListings = await client.getActiveListings({ $top: 20 });
// const torontoProperties = await client.searchByCity('Toronto', { $top: 10 });
// const affordableProperties = await client.searchByPriceRange(100000, 500000);
//
// // Media queries
// const media = await client.getMedia('61400d19-417e-4f43-b36e-efffb352a128');
// const propertyMedia = await client.getPropertyMedia('12345', 'Large');
// const officeLogo = await client.getOfficeMedia('123456');
// const memberPhoto = await client.getMemberMedia('123456');
// const recentMedia = await client.getRecentlyModifiedMedia('Property', '2023-07-27T04:00:00Z', 'Large');
