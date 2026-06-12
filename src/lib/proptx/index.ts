// ProptX VOW (Virtual Office Website) API Integration
// Supports IDX, DLA, and VOW tokens

export {
  ProptXClient,
  createIdxClient,
  createDlaClient,
  createIdxClientFromEnv,
  testConnection,
} from './client';

export type { TokenType } from './client';

export type {
  Property,
  Media,
  OpenHouse,
  PropertyRoom,
  Office,
  PropertySearchParams,
  PropertyResponse,
  MediaResponse,
  OpenHouseResponse,
  PropertyRoomResponse,
  ProptXError,
} from './types';

// Example usage:
//
// import { createIdxClientFromEnv } from '@/lib/proptx';
//
// const client = createIdxClientFromEnv();
// const properties = await client.getActiveListings({ $top: 20 });
// const torontoProps = await client.searchByCity('Toronto');
//
// // Get media and rooms for a listing
// const media = await client.getMedia('X9234419');
// const rooms = await client.getRooms('X9234419');
// const openHouses = await client.getOpenHouses();