/**
 * Shadow MLS - Assignment Detector
 * 
 * Detects pre-construction and assignment sale opportunities.
 * Assignment sales occur when original buyers sell their pre-construction contracts
 * before closing, often at a discount (original purchase price below market).
 * 
 * Key indicators:
 * - PublicRemarks mentions "assignment sale", "exclusive assignment", etc.
 * - TaxAnnualAmount is 0 or null (property never assessed, pre-construction)
 * - Usually no utilities set up, no actual occupancy
 */

const ASSIGNMENT_PATTERNS = [
  /assignment sale/i,
  /assign\. sale/i,
  /exclusive assignment/i,
  /pre-construction assignment/i,
  /precon assignment/i,
  /original purchase price/i,
  /contract assignment/i,
];

const DEFAULT_SCORE = 50;
const DEFAULT_FLAG = 'ASSIGNMENT_SALE';

/**
 * Check if listing text contains assignment sale indicators
 * @param {string} text - Combined text to search
 * @returns {boolean} - True if any pattern matched
 */
function matchesAssignmentPattern(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return ASSIGNMENT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Detect assignment sale from listing data
 * @param {Object} listing - Listing record with PublicRemarks, PublicRemarksExtras, Directions, TaxAnnualAmount
 * @returns {Object} - { isAssignment, distressScore, dealTypeFlag }
 */
function detectAssignmentSale(listing) {
  try {
    // Combine relevant text fields for pattern matching
    const combinedText = [
      listing.PublicRemarks || '',
      listing.PublicRemarksExtras || '',
      listing.Directions || '',
    ].join(' ');

    const isAssignment = matchesAssignmentPattern(combinedText);
    
    if (!isAssignment) {
      return {
        isAssignment: false,
        distressScore: 0,
        dealTypeFlag: 'STANDARD',
      };
    }

    // TaxAnnualAmount must be 0 or null for assignment sale
    const taxAmount = listing.TaxAnnualAmount;
    const hasValidTax = taxAmount === null || taxAmount === undefined || taxAmount === 0;

    if (hasValidTax) {
      return {
        isAssignment: true,
        distressScore: DEFAULT_SCORE,
        dealTypeFlag: DEFAULT_FLAG,
      };
    }

    // Tax amount exists - still might be assignment but less certain
    // Log a warning but still flag it
    console.warn(`[AssignmentDetector] Potential assignment sale ${listing.ListingKey || 'unknown'} has non-zero tax: ${taxAmount}`);
    
    return {
      isAssignment: true,
      distressScore: DEFAULT_SCORE - 10, // Slightly lower confidence
      dealTypeFlag: DEFAULT_FLAG,
    };

  } catch (error) {
    console.error('[AssignmentDetector] Error detecting assignment sale:', error.message);
    
    // Log to etl_error_log via Supabase if listingKey available
    if (listing?.ListingKey) {
      logETLError(listing, error);
    }
    
    return {
      isAssignment: false,
      distressScore: 0,
      dealTypeFlag: 'STANDARD',
    };
  }
}

/**
 * Log ETL error to Supabase etl_error_log table
 * @param {Object} listing - Listing record
 * @param {Error} error - Error object
 */
async function logETLError(listing, error) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn('[AssignmentDetector] Supabase credentials not available for error logging');
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    await supabase.from('etl_error_log').insert({
      ml_number: listing.ListingKey || null,
      raw_payload: listing,
      error_message: error.message,
      error_stack: error.stack,
    });
    
  } catch (logError) {
    console.error('[AssignmentDetector] Failed to log ETL error:', logError.message);
  }
}

/**
 * Main export - detect assignment sale from any listing object
 * @param {Object} listing - Listing data
 * @returns {Object} - Detection result with distressScore and dealTypeFlag
 */
function AssignmentDetector(listing) {
  const result = detectAssignmentSale(listing);
  return {
    ...result,
    source: 'AssignmentDetector',
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  AssignmentDetector,
  detectAssignmentSale,
  matchesAssignmentPattern,
  logETLError,
};