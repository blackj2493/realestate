/**
 * AVM Validation Schema
 */

import { z } from 'zod';

export const AVMInputSchema = z.object({
  cityRegion: z.string().min(1, 'City/Region is required'),
  propertySubType: z.string().min(1, 'Property type is required'),
  bedroomsAboveGrade: z.number().int().min(0).max(10),
  bathroomsTotalInteger: z.number().int().min(0).max(10),
  parkingTotal: z.number().int().min(0).max(10),
  interiorTier: z.number().int().min(1).max(5),
  exteriorTier: z.number().int().min(1).max(5),
  basementTier: z.number().int().min(1).max(9),
});

export type AVMInputZod = z.infer<typeof AVMInputSchema>;