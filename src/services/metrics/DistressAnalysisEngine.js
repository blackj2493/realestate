/**
 * Shadow MLS - Distress Analysis Engine
 * 
 * Tiered distress scoring system for flipper analysis.
 * 
 * TIER 1 - INSTANT DETECTION (highest priority, exits immediately)
 *   Regex patterns for legal/financial distress indicators
 *   Score: 100, Flag: 'LEGAL_DISTRESS'
 * 
 * TIER 2 - SCORING ENGINE (accumulates points)
 *   Condition clues + property state factors
 *   Score: 0-75, Flag: 'FIXER_UPPER' | 'MOTIVATED_SELLER' | 'STANDARD'
 */

const LEGAL_DISTRESS_PATTERNS = [
  /p(ower)?[\s\.]*o(f)?[\s\.]*s(ale)?/i,        // Power of Sale, Pos
  /lender[\s\w]*sell/i,                          // Lender Sell
  /court[\s\w]*order/i,                          // Court Ordered Sale
  /estate[\s\w]*sale/i,                          // Estate Sale
  /schedule[\s"']*x/i,                           // Schedule X (bankruptcy)
];

const CONDITION_PATTERNS = [
  /as-is/i,
  /where-is/i,
  /as is where is/i,
  /no representations/i,
  /no warranties/i,
  /buyer to verify/i,
  /handyman special/i,
  /bring your contractor/i,
  /needs tlc/i,
  /fire damage/i,
  /gut remodel/i,
  /deferred maintenance/i,
];

const LEGAL_DISTRESS_SCORE = 100;
const LEGAL_DISTRESS_FLAG = 'LEGAL_DISTRESS';

const FIXER_UPPER_SCORE = 75;
const MOTIVATED_SELLER_SCORE = 40;
const STANDARD_SCORE = 0;

/**
 * Check if text matches any pattern in array
 */
function matchesAnyPattern(text, patterns) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return patterns.some(pattern => pattern.test(text));
}

/**
 * Check for Tier 1 instant legal distress indicators
 * @param {string} text - Combined PublicRemarks + Directions
 * @returns {boolean} - True if legal distress detected
 */
function detectLegalDistress(text) {
  return matchesAnyPattern(text, LEGAL_DISTRESS_PATTERNS);
}

/**
 * Score Tier 2 condition factors
 * @param {Object} listing - Listing data
 * @param {number} trueDom - True days on market
 * @returns {number} - Condition score (0-8 max)
 */
function scoreConditionFactors(listing, trueDom) {
  let score = 0;

  // +3 points: Condition regex match
  const combinedText = (listing.PublicRemarks || '') + ' ' + (listing.Directions || '');
  if (matchesAnyPattern(combinedText, CONDITION_PATTERNS)) {
    score += 3;
  }

  // +1 point: Vacant property
  if (listing.OccupantType === 'Vacant') {
    score += 1;
  }

  // +1 point: Unfinished basement
  const basement = listing.BasementType;
  if (basement && (basement.includes('Unfinished') || basement === 'Unfinished')) {
    score += 1;
  }

  // +1 point: True DOM > 60 days
  if (trueDom && trueDom > 60) {
    score += 1;
  }

  // +2 points: True DOM > 120 days
  if (trueDom && trueDom > 120) {
    score += 2;
  }

  return score;
}

/**
 * Evaluate final score based on Tier 2 accumulated points
 * @param {number} score - Accumulated condition score
 * @returns {Object} - { distressScore, dealTypeFlag }
 */
function evaluateScore(score) {
  if (score >= 4) {
    return {
      distressScore: FIXER_UPPER_SCORE,
      dealTypeFlag: 'FIXER_UPPER',
    };
  }
  
  if (score === 3) {
    return {
      distressScore: MOTIVATED_SELLER_SCORE,
      dealTypeFlag: 'MOTIVATED_SELLER',
    };
  }
  
  return {
    distressScore: STANDARD_SCORE,
    dealTypeFlag: 'STANDARD',
  };
}

/**
 * Main detection function
 * @param {Object} listing - Listing record
 * @param {Object} options - { trueDom, etc. }
 * @returns {Object} - { distressScore, dealTypeFlag, source }
 */
function DistressAnalysisEngine(listing, options = {}) {
  try {
    const trueDom = options.trueDom || listing.true_dom || listing.TrueDom || 0;
    
    // Tier 1: Instant legal distress check
    const combinedText = (listing.PublicRemarks || '') + ' ' + (listing.Directions || '');
    if (detectLegalDistress(combinedText)) {
      return {
        distressScore: LEGAL_DISTRESS_SCORE,
        dealTypeFlag: LEGAL_DISTRESS_FLAG,
        source: 'DistressAnalysisEngine.Tier1',
        timestamp: new Date().toISOString(),
      };
    }

    // Tier 2: Accumulate condition score
    const conditionScore = scoreConditionFactors(listing, trueDom);
    const result = evaluateScore(conditionScore);

    return {
      ...result,
      source: 'DistressAnalysisEngine.Tier2',
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    console.error('[DistressAnalysisEngine] Error:', error.message);
    
    if (listing?.ListingKey) {
      logETLError(listing, error);
    }
    
    return {
      distressScore: STANDARD_SCORE,
      dealTypeFlag: 'STANDARD',
      source: 'DistressAnalysisEngine.Error',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Log ETL error to Supabase
 */
async function logETLError(listing, error) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
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
    console.error('[DistressAnalysisEngine] Failed to log error:', logError.message);
  }
}

module.exports = {
  DistressAnalysisEngine,
  detectLegalDistress,
  scoreConditionFactors,
  evaluateScore,
  LEGAL_DISTRESS_PATTERNS,
  CONDITION_PATTERNS,
};