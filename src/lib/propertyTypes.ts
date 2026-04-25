// Property Type Classification Utility
// Classifies PropertySubType into Residential or Commercial categories

// Residential subtypes: Detached, Semi-Detached, Townhouse, Condo, etc.
const RESIDENTIAL_SUBTYPES = [
  // Residential
  'Detached',
  'Semi-Detached',
  'Attached/Row/Street Townhouse',
  'Link',
  'Rural Residence',
  'Duplex',
  'Triplex',
  'Fourplex',
  'Multiplex',
  'Cottage',
  'Vacant Land',
  'Detached with Common Elements',
  'Mobile/Trailer',
  'Other',
  // Condo
  'Condo Apartment',
  'Condo Townhouse',
  'Detached Condo',
  'Semi-Detached Condo',
  'Co-Op Apartment',
  'Co-Ownership Apartment',
  'Common Element Condo',
  'Leasehold Condo',
  'Phased Condo',
  'Time Share',
  'Vacant Land Condo',
];

// Commercial subtypes: Commercial/Retail, Industrial, Office, Land, etc.
const COMMERCIAL_SUBTYPES = [
  'Commercial/Retail',
  'Industrial',
  'Investment',
  'Land',
  'Office',
  'Sale Of Business',
  'Store with Apt/Office',
  'Farm', // Farm appears in both, treating as Commercial
];

// Listings to always exclude (separate property listings, not real estate)
const EXCLUDED_LISTING_TYPES = [
  'Parking Space',
  'Locker',
  'Storage',
];

/**
 * Get the property category (Residential or Commercial) from a PropertySubType
 */
export function getPropertyCategory(subType: string | undefined | null): 'Residential' | 'Commercial' | 'Unknown' {
  if (!subType) return 'Unknown';
  
  // Check if it's a commercial subtype
  if (COMMERCIAL_SUBTYPES.some(t => subType.toLowerCase().includes(t.toLowerCase()))) {
    return 'Commercial';
  }
  
  // Check if it's a residential subtype
  if (RESIDENTIAL_SUBTYPES.some(t => subType.toLowerCase().includes(t.toLowerCase()))) {
    return 'Residential';
  }
  
  return 'Unknown';
}

/**
 * Check if a property subtype should be excluded (Parking Space, Locker, Storage)
 */
export function isExcludedListing(subType: string | undefined | null): boolean {
  if (!subType) return false;
  return EXCLUDED_LISTING_TYPES.some(t => subType.toLowerCase().includes(t.toLowerCase()));
}

/**
 * Get the property type label for display
 */
export function getPropertyTypeLabel(subType: string | undefined | null): string {
  if (!subType) return 'Unknown';
  return subType;
}

/**
 * Check if a property should be included based on listing type filter
 * @param subType - PropertySubType from API
 * @param listingType - Filter choice: 'all', 'residential', 'commercial'
 */
export function shouldIncludeProperty(
  subType: string | undefined | null,
  listingType: 'all' | 'residential' | 'commercial'
): boolean {
  // Always exclude parking, locker, storage
  if (isExcludedListing(subType)) {
    return false;
  }
  
  // If 'all', include everything else
  if (listingType === 'all') {
    return true;
  }
  
  const category = getPropertyCategory(subType);
  
  if (listingType === 'residential') {
    return category === 'Residential';
  }
  
  if (listingType === 'commercial') {
    return category === 'Commercial';
  }
  
  return true;
}

// Export the lists for reference
export const PROPERTY_SUBTYPES = {
  RESIDENTIAL: RESIDENTIAL_SUBTYPES,
  COMMERCIAL: COMMERCIAL_SUBTYPES,
  EXCLUDED: EXCLUDED_LISTING_TYPES,
} as const;
