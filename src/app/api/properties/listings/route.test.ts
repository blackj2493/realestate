import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/typesense/client', () => ({
  searchListings: vi.fn(),
}));
vi.mock('@/lib/postalCodes', () => ({
  loadPostalCodes: vi.fn(),
  getCoordinates: vi.fn(() => null),
  getCityCenter: vi.fn(() => ({ lat: 43.6532, lng: -79.3832 })),
}));

import { searchListings, type SearchResult, type ListingDocument } from '@/lib/typesense/client';
import { GET } from './route';

const mockSearch = vi.mocked(searchListings);

function get(url: string): Promise<Response> {
  return GET(new NextRequest(new URL(url)));
}

function searchResult(listings: ListingDocument[] = [], totalFound = 0): SearchResult {
  return { listings, totalFound, page: 1, perPage: listings.length, processingTimeMs: 1 };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue(searchResult());
});

describe('GET /api/properties/listings — TRREB §4 pagination clamp', () => {
  it('clamps limit=500 down to 100 (compliance ceiling)', async () => {
    await get('http://x/api/properties/listings?limit=500');
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0].perPage).toBe(100);
  });

  it('caps an absurd limit=10000 at 100', async () => {
    await get('http://x/api/properties/listings?limit=10000');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(100);
  });

  it('passes a within-range limit through verbatim', async () => {
    await get('http://x/api/properties/listings?limit=42');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(42);
  });

  it('defaults to 50 when limit is omitted', async () => {
    await get('http://x/api/properties/listings');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(50);
  });

  it('floors limit=0 / negative / NaN to 1 (no "give me everything" trick)', async () => {
    await get('http://x/api/properties/listings?limit=0');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(1);

    mockSearch.mockClear();
    await get('http://x/api/properties/listings?limit=-50');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(1);

    mockSearch.mockClear();
    await get('http://x/api/properties/listings?limit=abc');
    expect(mockSearch.mock.calls[0][0].perPage).toBe(50);
  });
});

describe('GET /api/properties/listings — filter passthrough', () => {
  it('translates transactionType=rent → "For Lease"', async () => {
    await get('http://x/api/properties/listings?type=rent');
    expect(mockSearch.mock.calls[0][0].filters?.transactionType).toBe('For Lease');
  });

  it('defaults transactionType to "For Sale"', async () => {
    await get('http://x/api/properties/listings');
    expect(mockSearch.mock.calls[0][0].filters?.transactionType).toBe('For Sale');
  });

  it('parses min/max price into the filter object', async () => {
    await get('http://x/api/properties/listings?minPrice=500000&maxPrice=900000');
    const filters = mockSearch.mock.calls[0][0].filters;
    expect(filters?.minPrice).toBe(500_000);
    expect(filters?.maxPrice).toBe(900_000);
  });

  it('ignores BedroomsAboveGrade when set to "Any" or "0"', async () => {
    await get('http://x/api/properties/listings?BedroomsAboveGrade=Any');
    expect(mockSearch.mock.calls[0][0].filters?.minBedrooms).toBeUndefined();

    mockSearch.mockClear();
    await get('http://x/api/properties/listings?BedroomsAboveGrade=0');
    expect(mockSearch.mock.calls[0][0].filters?.minBedrooms).toBeUndefined();

    mockSearch.mockClear();
    await get('http://x/api/properties/listings?BedroomsAboveGrade=3');
    expect(mockSearch.mock.calls[0][0].filters?.minBedrooms).toBe(3);
  });

  it('falls back from `search` to `city` to `*` when both are missing', async () => {
    await get('http://x/api/properties/listings?city=Brampton');
    expect(mockSearch.mock.calls[0][0].query).toBe('Brampton');

    mockSearch.mockClear();
    await get('http://x/api/properties/listings');
    expect(mockSearch.mock.calls[0][0].query).toBe('*');
  });
});

describe('GET /api/properties/listings — response shape + errors', () => {
  it('shapes the Typesense result into the public { listings, pagination } envelope', async () => {
    mockSearch.mockResolvedValueOnce(
      searchResult(
        [
          {
            id: 'W12632618',
            ListPrice: 1_699_900,
            UnparsedAddress: '40 Rampart Drive, Brampton, ON L6P 2Z1',
            City: 'Brampton',
            location: [43.6532, -79.3832],
            isDistressed: false,
            hasSecondarySuitePotential: false,
          },
        ],
        1
      )
    );
    const res = await get('http://x/api/properties/listings?limit=20');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0].ListingKey).toBe('W12632618');
    expect(body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      hasMore: false,
    });
  });

  it('returns 500 when searchListings throws', async () => {
    mockSearch.mockRejectedValueOnce(new Error('typesense down'));
    const res = await get('http://x/api/properties/listings');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Search failed');
  });
});
