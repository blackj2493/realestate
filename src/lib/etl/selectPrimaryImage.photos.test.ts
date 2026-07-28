import { describe, it, expect } from 'vitest';
import {
  selectPrimaryImage,
  photoUrls,
  primaryImageFromPhotos,
  storedPhotosToMediaItems,
  mediaUrlsToMediaItems,
  collectMediaUrls,
} from './selectPrimaryImage';

/**
 * Migration 101 moved sold thumbnails off raw_payload->'media' and onto the flat
 * `photos` column. These lock in the two properties that move depends on:
 *   1. photos[0] is what selectPrimaryImage() would have picked, and
 *   2. the unwrap tolerates the shapes the DB can actually hand back.
 */
describe('photoUrls', () => {
  it('unwraps stored photos in order', () => {
    expect(photoUrls([{ u: 'a' }, { u: 'b', c: 'Kitchen' }, { u: 'c' }])).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for null / undefined / non-array (column is nullable)', () => {
    expect(photoUrls(null)).toEqual([]);
    expect(photoUrls(undefined)).toEqual([]);
    expect(photoUrls({})).toEqual([]);
  });

  it('skips malformed entries rather than emitting undefined', () => {
    expect(photoUrls([{ u: 'a' }, {}, { u: '' }, { u: 'b' }])).toEqual(['a', 'b']);
  });
});

describe('primaryImageFromPhotos', () => {
  it('returns the first photo', () => {
    expect(primaryImageFromPhotos([{ u: 'first' }, { u: 'second' }])).toBe('first');
  });

  it('returns null when there are no photos', () => {
    expect(primaryImageFromPhotos([])).toBeNull();
    expect(primaryImageFromPhotos(null)).toBeNull();
  });

  it('agrees with selectPrimaryImage on the sold data shape', () => {
    // Every TRREB sold photo is ImageSizeDescription='Medium', and the stored column is
    // already Active-only, de-duplicated and Order-sorted — so the two must agree.
    const rawMedia = [
      { MediaURL: 'z', MediaStatus: 'Active', Order: 2, ImageSizeDescription: 'Medium' },
      { MediaURL: 'a', MediaStatus: 'Active', Order: 0, ImageSizeDescription: 'Medium' },
      { MediaURL: 'm', MediaStatus: 'Active', Order: 1, ImageSizeDescription: 'Medium' },
    ];
    const stored = [{ u: 'a' }, { u: 'm' }, { u: 'z' }]; // what the backfill produces

    expect(selectPrimaryImage({ media: rawMedia })).toBe('a');
    expect(primaryImageFromPhotos(stored)).toBe('a');
  });

  it('agrees when the lowest-Order photo was Deleted (backfill excluded it)', () => {
    const rawMedia = [
      { MediaURL: 'gone', MediaStatus: 'Deleted', Order: 0, ImageSizeDescription: 'Medium' },
      { MediaURL: 'kept', MediaStatus: 'Active', Order: 1, ImageSizeDescription: 'Medium' },
    ];
    const stored = [{ u: 'kept' }]; // Deleted never reaches the column

    expect(selectPrimaryImage({ media: rawMedia })).toBe('kept');
    expect(primaryImageFromPhotos(stored)).toBe('kept');
  });
});

/**
 * These two feed preserveExistingMedia — the nightly path that restores photos when
 * AMPRE's /Media call fails. If they returned nothing, a failed fetch would write empty
 * media and wipe a listing's photos permanently, so the round-trip matters.
 */
describe('inflating stored columns back to MediaItem', () => {
  it('mediaUrlsToMediaItems round-trips through collectMediaUrls', () => {
    const urls = ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'];
    const items = mediaUrlsToMediaItems(urls);

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ MediaURL: 'https://cdn/a.jpg', MediaStatus: 'Active', Order: 0 });
    // The restored array must survive collectMediaUrls unchanged, or the next sync
    // would write back a shorter media_urls than it started with.
    expect(collectMediaUrls({ media: items })).toEqual(urls);
    expect(selectPrimaryImage({ media: items })).toBe(urls[0]);
  });

  it('storedPhotosToMediaItems preserves order and captions', () => {
    const items = storedPhotosToMediaItems([{ u: 'a' }, { u: 'b', c: 'Kitchen' }]);
    expect(items[0]).toEqual({ MediaURL: 'a', MediaStatus: 'Active', Order: 0, ImageSizeDescription: 'Medium' });
    expect(items[1]).toMatchObject({ MediaURL: 'b', Order: 1, ShortDescription: 'Kitchen' });
    expect(collectMediaUrls({ media: items })).toEqual(['a', 'b']);
  });

  it('both tolerate null/garbage without throwing (columns are nullable)', () => {
    expect(mediaUrlsToMediaItems(null)).toEqual([]);
    expect(mediaUrlsToMediaItems([null, '', 'ok'])).toHaveLength(1);
    expect(storedPhotosToMediaItems(undefined)).toEqual([]);
    expect(storedPhotosToMediaItems([{}, { u: 'ok' }])).toHaveLength(1);
  });
});
