/**
 * Shadow MLS - Holding Cost Calculator
 * 
 * Calculates maximum monthly holding costs for flipper analysis.
 * 
 * Components:
 * - Interest: (targetPrice * 0.75 * rate) / 12
 * - Taxes: TaxAnnualAmount/12 OR (targetPrice * 0.01) / 12
 * - Vacancy Insurance: 90 (condo) : 250 (freehold)
 * - Utilities: 120 (condo) : 350 (multi-family/freehold)
 * - HOA Fees: AssociationFee
 * - Maintenance Reserve: (targetPrice * 0.005) / 12
 * 
 * Fetches alternative_investor_rate from system_config table (default: 0.0799)
 */

const DEFAULT_INVESTOR_RATE = 0.0799;
const FALLBACK_HOLDING_RATE = 0.008; // 0.8% monthly fallback

let cachedRate = null;
let rateCacheTime = null;
const RATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CHEAP_PROPERTY_TYPES = ['Detached', 'Semi-Detached', 'Link'];

/**
 * Fetch investor rate from system_config or use default
 */
async function fetchInvestorRate(supabase) {
  const now = Date.now();
  
  // Return cached rate if still valid
  if (cachedRate && rateCacheTime && (now - rateCacheTime) < RATE_CACHE_TTL_MS) {
    return cachedRate;
  }

  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'alternative_investor_rate')
      .single();
    
    if (error) {
      console.warn('[HoldingCostCalculator] Failed to fetch rate, using default:', error.message);
      cachedRate = DEFAULT_INVESTOR_RATE;
    } else {
      cachedRate = parseFloat(data.config_value);
    }
    
    rateCacheTime = now;
    return cachedRate;
    
  } catch (err) {
    console.warn('[HoldingCostCalculator] Rate fetch error, using default:', err.message);
    cachedRate = DEFAULT_INVESTOR_RATE;
    rateCacheTime = now;
    return cachedRate;
  }
}

/**
 * Fetch subtype average price from regional_price_cache
 */
async function fetchSubtypeAvg(supabase, propertySubType, city) {
  try {
    const { data, error } = await supabase
      .from('regional_price_cache')
      .select('avg_price')
      .eq('property_subtype', propertySubType)
      .eq('city', city)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return data.avg_price;
    
  } catch (err) {
    return null;
  }
}

/**
 * Calculate holding cost components for a listing
 */
function calculateHoldingComponents(listing, targetPrice, rate, isCondo) {
  // Interest: (targetPrice * 0.75 * rate) / 12
  // 0.75 = 75% LTV (25% down payment)
  const interest = (targetPrice * 0.75 * rate) / 12;

  // Taxes: actual or estimate
  let taxes;
  if (listing.TaxAnnualAmount && listing.TaxAnnualAmount > 0) {
    taxes = listing.TaxAnnualAmount / 12;
  } else {
    // Estimate: 1% of value annually
    taxes = (targetPrice * 0.01) / 12;
  }

  // Vacancy Insurance: 90 (condo) : 250 (freehold)
  const vacancyInsurance = isCondo ? 90 : 250;

  // Utilities: 120 (condo) : 350 (multi-family/freehold)
  // For condos, assume tenant pays utilities
  const utilities = isCondo ? 120 : 350;

  // HOA Fees: AssociationFee or 0
  const hoaFees = listing.AssociationFee || 0;

  // Maintenance Reserve: (targetPrice * 0.005) / 12
  // 0.5% annual maintenance reserve
  const maintenanceReserve = (targetPrice * 0.005) / 12;

  return {
    interest: Math.round(interest),
    taxes: Math.round(taxes),
    vacancyInsurance,
    utilities,
    hoaFees: Math.round(hoaFees),
    maintenanceReserve: Math.round(maintenanceReserve),
  };
}

/**
 * Check if property is condo
 */
function isCondoProperty(listing) {
  // Condo if: PropertyType contains 'Condo' OR CondoCorpNumber exists
  const propertyType = listing.PropertyType || '';
  const hasCondoType = propertyType.toLowerCase().includes('condo');
  const hasCondoCorp = listing.CondoCorpNumber && listing.CondoCorpNumber !== '';
  
  return hasCondoType || hasCondoCorp;
}

/**
 * Main holding cost calculator function
 * @param {Object} listing - Listing record
 * @param {Object} supabase - Supabase client (for config fetch)
 * @returns {Object} - { maxHoldingCost, components }
 */
async function HoldingCostCalculator(listing, supabase) {
  try {
    const listPrice = listing.ListPrice || 0;
    const propertySubType = listing.PropertySubType || '';
    const city = listing.City || '';
    
    // Fetch investor rate
    const rate = await fetchInvestorRate(supabase);
    
    // Determine target price
    let targetPrice = listPrice;
    
    // If price is low AND property is cheap type, check regional average
    if (listPrice < 400000 && CHEAP_PROPERTY_TYPES.includes(propertySubType)) {
      const subtypeAvg = await fetchSubtypeAvg(supabase, propertySubType, city);
      if (subtypeAvg && subtypeAvg > listPrice) {
        targetPrice = subtypeAvg;
      }
    }
    
    const isCondo = isCondoProperty(listing);
    const components = calculateHoldingComponents(listing, targetPrice, rate, isCondo);
    
    // Sum all components
    const totalHoldingCost = 
      components.interest +
      components.taxes +
      components.vacancyInsurance +
      components.utilities +
      components.hoaFees +
      components.maintenanceReserve;
    
    // Round to integer
    const maxHoldingCost = Math.round(totalHoldingCost);
    
    // Validate result
    if (isNaN(maxHoldingCost) || maxHoldingCost <= 0) {
      console.warn(`[HoldingCostCalculator] Invalid result ${maxHoldingCost} for ${listing.ListingKey}, using fallback`);
      const fallback = Math.round(targetPrice * FALLBACK_HOLDING_RATE);
      return {
        maxHoldingCost: fallback,
        components: null,
        isFallback: true,
        warning: `Invalid holding cost calculation, fallback: ${fallback}`,
      };
    }
    
    return {
      maxHoldingCost,
      components,
      isFallback: false,
      targetPrice,
      investorRate: rate,
    };
    
  } catch (error) {
    console.error('[HoldingCostCalculator] Error:', error.message);
    
    if (listing?.ListingKey) {
      logETLError(listing, error);
    }
    
    // Return fallback
    const fallback = Math.round((listing.ListPrice || 0) * FALLBACK_HOLDING_RATE);
    return {
      maxHoldingCost: fallback,
      components: null,
      isFallback: true,
      warning: `Error: ${error.message}`,
    };
  }
}

/**
 * Synchronous version using cached/default rate
 * Use this when you don't have access to Supabase client
 */
function HoldingCostCalculatorSync(listing, options = {}) {
  try {
    const rate = options.rate || DEFAULT_INVESTOR_RATE;
    const listPrice = listing.ListPrice || 0;
    const targetPrice = listPrice;
    const isCondo = isCondoProperty(listing);
    
    const components = calculateHoldingComponents(listing, targetPrice, rate, isCondo);
    
    const totalHoldingCost = 
      components.interest +
      components.taxes +
      components.vacancyInsurance +
      components.utilities +
      components.hoaFees +
      components.maintenanceReserve;
    
    const maxHoldingCost = Math.round(totalHoldingCost);
    
    if (isNaN(maxHoldingCost) || maxHoldingCost <= 0) {
      const fallback = Math.round(targetPrice * FALLBACK_HOLDING_RATE);
      return { maxHoldingCost: fallback, components: null, isFallback: true };
    }
    
    return { maxHoldingCost, components, isFallback: false };
    
  } catch (error) {
    const fallback = Math.round((listing.ListPrice || 0) * FALLBACK_HOLDING_RATE);
    return { maxHoldingCost: fallback, components: null, isFallback: true };
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
    console.error('[HoldingCostCalculator] Failed to log error:', logError.message);
  }
}

module.exports = {
  HoldingCostCalculator,
  HoldingCostCalculatorSync,
  calculateHoldingComponents,
  fetchInvestorRate,
  DEFAULT_INVESTOR_RATE,
  FALLBACK_HOLDING_RATE,
};