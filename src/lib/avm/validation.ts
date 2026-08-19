/**
 * AVM Validation Schema
 */

import { z } from 'zod';

/**
 * Place names only — letters, digits, spaces and . ' - / & ( ) , (e.g. "Toronto C01",
 * "Bedford Park-Nortown", "St. Catharines"). Bounded at 80 chars.
 *
 * These values reach raw_vow_sold filters. They are now matched with equality rather
 * than ILIKE (migration 099), so a wildcard is inert — but an unbounded, uncharacterised
 * string still has no business being a cohort key, and before 099 a posted "%" matched
 * all ~289k sold rows on a single request. Defence in depth.
 */
const PLACE_NAME = z
  .string()
  .max(80, 'City name too long')
  .regex(/^[\p{L}\p{N} .'\-/&(),]*$/u, 'City contains unsupported characters');

export const AVMInputSchema = z.object({
  cityRegion: PLACE_NAME.min(1, 'City/Region is required'),
  city: PLACE_NAME.nullable().optional(),
  propertySubType: z.string().min(1, 'Property type is required'),
  bedroomsAboveGrade: z.number().int().min(0).max(10),
  /** Den / below-grade bedrooms. Optional so existing callers keep working; absent
   *  means none, which is how the feed itself encodes zero. */
  bedroomsBelowGrade: z.number().int().min(0).max(10).optional().default(0),
  bathroomsTotalInteger: z.number().int().min(0).max(10),
  parkingTotal: z.number().int().min(0).max(10),
  interiorTier: z.number().int().min(1).max(5),
  exteriorTier: z.number().int().min(1).max(5),
  basementTier: z.number().int().min(1).max(9),
  /** Optional measured square footage; improves the AVM estimate when provided. */
  buildingAreaTotal: z.number().positive().nullable().optional(),
});

export type AVMInputZod = z.infer<typeof AVMInputSchema>;