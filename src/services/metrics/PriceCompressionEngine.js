/**
 * Shadow MLS - Price Compression Engine
 * 
 * Analyzes price history to detect deals based on:
 * - Price drops from peak
 * - Price drop velocity
 * - Capital discount from peak
 * 
 * Key Logic:
 * - Generate PID from StreetNumber|StreetName|City
 * - Fetch price_history_cache where pid matches AND gap < 45 days
 * - Calculate peak price, drop percentage, velocity
 */

const LISTING_KEY_DELIMITER = '|'; // For PID generation
const CAMPAIGN_GAP_DAYS = 45; // Same campaign if gap <= 45 days

/**
 * Generate PID (Property ID) from listing fields
 * Format: StreetNumber|StreetName|City
 */
function generatePID(listing) {
  const streetNumber = (listing.StreetNumber || '').trim();
  const streetName = (listing.StreetName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const city = (listing.City || '').trim().toLowerCase().replace(/\s+/g, ' ');
  
  if (!streetNumber || !streetName || !city) {
    return null;
  }
  
  return `${streetNumber}${LISTING_KEY_DELIMITER}${streetName}${LISTING_KEY_DELIMITER}${city}`;
}

/**
 * Fetch price history from cache
 */
async function fetchPriceHistory(supabase, pid, currentDate) {
  try {
    const { data, error } = await supabase
      .from('price_history_cache')
      .select('list_price, listed_date')
      .eq('pid', pid)
      .order('listed_date', { ascending: false });
    
    if (error) {
      console.warn('[PriceCompressionEngine] Price history fetch error:', error.message);
      return [];
    }
    
    // Filter to entries within campaign gap
    const cutoffDate = new Date(currentDate);
    cutoffDate.setDate(cutoffDate.getDate() - CAMPAIGN_GAP_DAYS);
    
    return (data || []).filter(entry => {
      const entryDate = new Date(entry.listed_date);
      return entryDate >= cutoffDate;
    });
    
  } catch (err) {
    console.warn('[PriceCompressionEngine] Price history fetch exception:', err.message);
    return [];
  }
}

/**
 * Calculate price drop percentage safely
 */
function calcPriceDropPct(peakPrice, currentPrice) {
  if (!peakPrice || peakPrice <= 0) {
    return 0;
  }
  if (!currentPrice || currentPrice <= 0) {
    return 0;
  }
  
  const drop = ((peakPrice - currentPrice) / peakPrice) * 100;
  
  // Handle NaN/Infinity
  if (isNaN(drop) || !isFinite(drop)) {
    return 0;
  }
  
  return Math.round(drop * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate price velocity (rate of change between price points)
 */
function calcPriceVelocity(previousPrice, currentPrice) {
  if (!previousPrice || previousPrice <= 0) {
    return 0;
  }
  if (!currentPrice || currentPrice <= 0) {
    return 0;
  }
  
  const velocity = ((previousPrice - currentPrice) / previousPrice) * 100;
  
  if (isNaN(velocity) || !isFinite(velocity)) {
    return 0;
  }
  
  return Math.round(velocity * 10) / 10;
}

/**
 * Main price compression analyzer
 * @param {Object} listing - Listing record with ListPrice
 * @param {Object} supabase - Supabase client
 * @returns {Object} - { peakPrice, truePriceDropPct, priceDropVelocity, capitalDiscount, pid }
 */
async function PriceCompressionEngine(listing, supabase) {
  try {
    const currentPrice = listing.ListPrice || 0;
    const currentDate = new Date();
    
    // Skip for very low price listings
    if (currentPrice < 200000) {
      return {
        peakPrice: currentPrice,
        truePriceDropPct: 0,
        priceDropVelocity: 0,
        capitalDiscount: 0,
        pid: generatePID(listing),
        skippedLowPrice: true,
      };
    }
    
    // Generate PID
    const pid = generatePID(listing);
    if (!pid) {
      console.warn('[PriceCompressionEngine] Could not generate PID for listing');
      return {
        peakPrice: currentPrice,
        truePriceDropPct: 0,
        priceDropVelocity: 0,
        capitalDiscount: 0,
        pid: null,
      };
    }
    
    // Fetch historical prices
    const history = await fetchPriceHistory(supabase, pid, currentDate);
    const historicalPrices = history.map(h => h.list_price);
    
    // Calculate peak price
    const allPrices = [...historicalPrices, currentPrice];
    const peakPrice = Math.max(...allPrices);
    
    // Calculate true price drop percentage
    const truePriceDropPct = calcPriceDropPct(peakPrice, currentPrice);
    
    // Calculate price drop velocity (using most recent previous price)
    const previousPrice = historicalPrices.length > 0 ? historicalPrices[0] : currentPrice;
    const priceDropVelocity = calcPriceVelocity(previousPrice, currentPrice);
    
    // Calculate capital discount
    const capitalDiscount = peakPrice - currentPrice;
    
    return {
      peakPrice,
      truePriceDropPct,
      priceDropVelocity,
      capitalDiscount: Math.max(0, capitalDiscount),
      pid,
      historicalPrices,
    };
    
  } catch (error) {
    console.error('[PriceCompressionEngine] Error:', error.message);
    
    if (listing?.ListingKey) {
      logETLError(listing, error);
    }
    
    return {
      peakPrice: listing.ListPrice || 0,
      truePriceDropPct: 0,
      priceDropVelocity: 0,
      capitalDiscount: 0,
      pid: generatePID(listing),
      error: error.message,
    };
  }
}

/**
 * Synchronous version for batch processing
 * Uses pre-fetched history if available
 */
function PriceCompressionEngineSync(listing, options = {}) {
  try {
    const currentPrice = listing.ListPrice || 0;
    const historicalPrices = options.historicalPrices || [];
    
    if (currentPrice < 200000) {
      return {
        peakPrice: currentPrice,
        truePriceDropPct: 0,
        priceDropVelocity: 0,
        capitalDiscount: 0,
        skippedLowPrice: true,
      };
    }
    
    const allPrices = [...historicalPrices, currentPrice];
    const peakPrice = Math.max(...allPrices);
    const truePriceDropPct = calcPriceDropPct(peakPrice, currentPrice);
    
    const previousPrice = historicalPrices.length > 0 ? historicalPrices[0] : currentPrice;
    const priceDropVelocity = calcPriceVelocity(previousPrice, currentPrice);
    
    const capitalDiscount = peakPrice - currentPrice;
    
    return {
      peakPrice,
      truePriceDropPct,
      priceDropVelocity,
      capitalDiscount: Math.max(0, capitalDiscount),
    };
    
  } catch (error) {
    return {
      peakPrice: listing.ListPrice || 0,
      truePriceDropPct: 0,
      priceDropVelocity: 0,
      capitalDiscount: 0,
      error: error.message,
    };
  }
}

/**
 * Log ETL error
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
    console.error('[PriceCompressionEngine] Failed to log error:', logError.message);
  }
}

module.exports = {
  PriceCompressionEngine,
  PriceCompressionEngineSync,
  generatePID,
  calcPriceDropPct,
  calcPriceVelocity,
  fetchPriceHistory,
  CAMPAIGN_GAP_DAYS,
};