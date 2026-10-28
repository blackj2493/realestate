/**
 * Census 2021 Profile characteristic ids (98-401-X2021006, CHARACTERISTIC_ID) that the area
 * card reads. One list feeds the extractor (scripts/worker/census/extractProfile.ts) and the
 * fact builder (areaFacts.ts), so the stored jsonb and the reader cannot drift.
 *
 * Facts about PLACES only. Ids for age, family status, ethnic origin, citizenship, language,
 * religion and subsidized housing are deliberately absent (Ontario Human Rights Code
 * protected grounds; TRESA). Do not add them.
 */
export const C = {
  pop2021: 1,
  pop2016: 2,
  dwellingsOccupied: 5,
  density: 6,
  // Structural type of dwelling (100% data)
  typeTotal: 41,
  typeSingle: 42,
  typeSemi: 43,
  typeRow: 44,
  typeDuplexApt: 45,
  typeAptUnder5: 46,
  typeApt5Plus: 47,
  typeOtherAttached: 48,
  typeMovable: 49,
  avgHouseholdSize: 57,
  medianHouseholdIncome: 243,
  // Household total income groups in 2020 (100% data)
  incTotal: 260,
  // Tenure (25% sample)
  tenureTotal: 1414,
  tenureOwner: 1415,
  tenureRenter: 1416,
  condoTotal: 1418,
  condo: 1419,
  // Bedrooms (25% sample)
  bedTotal: 1421,
  bed0: 1422,
  bed1: 1423,
  bed2: 1424,
  bed3: 1425,
  bed4Plus: 1426,
  // Period of construction (25% sample)
  builtTotal: 1440,
  built1960OrBefore: 1441,
  built1961to1980: 1442,
  built2016to2021: 1448,
  // Shelter costs
  ownerPctMortgage: 1483,
  ownerMedianShelter: 1486,
  tenantTotal: 1490,
  tenantPct30Plus: 1492,
  tenantMedianShelter: 1494,
  // Mobility 5 years ago
  mob5Total: 1983,
  mob5Movers: 1985,
  // Main mode of commuting
  modeTotal: 2603,
  modeCar: 2604,
  modeTransit: 2607,
  modeWalk: 2608,
  modeBike: 2609,
  modeOther: 2610,
  // Commuting duration
  durTotal: 2611,
  durUnder15: 2612,
  dur15to29: 2613,
  dur30to44: 2614,
  dur45to59: 2615,
  dur60Plus: 2616,
} as const;

/**
 * Household total income groups (ids 261..280) with their lower and upper bounds in dollars.
 * 276 ("$100,000 and over") is a subtotal of 277..280, so it is not in this list.
 */
export const INCOME_GROUPS: ReadonlyArray<{ id: number; lo: number; hi: number | null }> = [
  { id: 261, lo: 0, hi: 5_000 },
  { id: 262, lo: 5_000, hi: 10_000 },
  { id: 263, lo: 10_000, hi: 15_000 },
  { id: 264, lo: 15_000, hi: 20_000 },
  { id: 265, lo: 20_000, hi: 25_000 },
  { id: 266, lo: 25_000, hi: 30_000 },
  { id: 267, lo: 30_000, hi: 35_000 },
  { id: 268, lo: 35_000, hi: 40_000 },
  { id: 269, lo: 40_000, hi: 45_000 },
  { id: 270, lo: 45_000, hi: 50_000 },
  { id: 271, lo: 50_000, hi: 60_000 },
  { id: 272, lo: 60_000, hi: 70_000 },
  { id: 273, lo: 70_000, hi: 80_000 },
  { id: 274, lo: 80_000, hi: 90_000 },
  { id: 275, lo: 90_000, hi: 100_000 },
  { id: 277, lo: 100_000, hi: 125_000 },
  { id: 278, lo: 125_000, hi: 150_000 },
  { id: 279, lo: 150_000, hi: 200_000 },
  { id: 280, lo: 200_000, hi: null },
];

export const CENSUS_CHAR_IDS: number[] = [...Object.values(C), ...INCOME_GROUPS.map((g) => g.id)];
