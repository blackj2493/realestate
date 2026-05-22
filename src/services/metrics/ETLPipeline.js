/**
 * Shadow MLS - ETL Pipeline
 * 
 * Orchestrates all flipper metric engines for the 15-min sync cycle.
 * 
 * Pipeline Steps:
 * 1. AssignmentDetector - Check for assignment sale patterns
 * 2. DistressAnalysisEngine - Tier-based distress scoring
 * 3. HoldingCostCalculator - Calculate max holding costs
 * 4. PriceCompressionEngine - Analyze price drops and velocity
 * 
 * Merge Logic:
 * - Use higher distress score between assignment and distress engines
 * 
 * Output:
 * - Supabase upsert to properties table
 * - Typesense upsert for search
 */

const { AssignmentDetector, detectAssignmentSale } = require('./AssignmentDetector');
const { DistressAnalysisEngine } = require('./DistressAnalysisEngine');
const { HoldingCostCalculator, HoldingCostCalculatorSync } = require('./HoldingCostCalculator');
const { PriceCompressionEngine, PriceCompressionEngineSync, generatePID } = require('./PriceCompressionEngine');

/**
 * Merge distress results - use higher score
 */
function mergeDistressResults(assignmentResult, distressResult) {
  // Assignment sale takes precedence if detected
  if (assignmentResult.isAssignment) {
    // If both detected, use higher score
    if (distressResult.distressScore > assignmentResult.distressScore) {
      return {
        distressScore: distressResult.distressScore,
        dealTypeFlag: distressResult.dealTypeFlag,
        isAssignment: false, // Override - distress was higher
        mergedSource: 'DistressAnalysisEngine > AssignmentDetector',
      };
    }
    return {
      distressScore: assignmentResult.distressScore,
      dealTypeFlag: assignmentResult.dealTypeFlag,
      isAssignment: true,
      mergedSource: 'AssignmentDetector',
    };
  }
  
  // No assignment - use distress results
  return {
    distressScore: distressResult.distressScore,
    dealTypeFlag: distressResult.dealTypeFlag,
    isAssignment: false,
    mergedSource: 'DistressAnalysisEngine',
  };
}

/**
 * Process a single listing through all engines
 * @param {Object} listing - Raw listing data
 * @param {Object} supabase - Supabase client
 * @param {Object} options - { trueDom, typesenseClient, etc. }
 * @returns {Object} - Combined flipper metrics
 */
async function processListing(listing, supabase, options = {}) {
  try {
    // Step 1: Assignment Detection
    const assignmentResult = detectAssignmentSale(listing);
    
    // Step 2: Distress Analysis
    const distressResult = DistressAnalysisEngine(listing, { 
      trueDom: options.trueDom || 0 
    });
    
    // Step 3: Merge distress results (use higher score)
    const mergedDistress = mergeDistressResults(assignmentResult, distressResult);
    
    // Step 4: Price Compression (async - needs Supabase)
    const priceCompression = await PriceCompressionEngine(listing, supabase);
    
    // Step 5: Holding Cost (async - needs Supabase for rate fetch)
    const holdingCost = await HoldingCostCalculator(listing, supabase);
    
    // Combine all results
    return {
      listingKey: listing.ListingKey || listing.listing_key,
      // Distress metrics
      distressScore: mergedDistress.distressScore,
      dealTypeFlag: mergedDistress.dealTypeFlag,
      isAssignment: mergedDistress.isAssignment,
      mergedSource: mergedDistress.mergedSource,
      // Price metrics
      peakPrice: priceCompression.peakPrice,
      truePriceDropPct: priceCompression.truePriceDropPct,
      priceDropVelocity: priceCompression.priceDropVelocity,
      capitalDiscount: priceCompression.capitalDiscount,
      // Holding cost
      maxHoldingCost: holdingCost.maxHoldingCost,
      targetPrice: holdingCost.targetPrice || listing.ListPrice,
      // PID for tracking
      pid: priceCompression.pid,
      // Errors/warnings
      warnings: [
        ...(holdingCost.isFallback ? [`HoldingCost fallback: ${holdingCost.warning}`] : []),
        ...(priceCompression.skippedLowPrice ? ['Skipped low price listing'] : []),
      ],
    };
    
  } catch (error) {
    console.error('[ETLPipeline] processListing error:', error.message);
    return {
      listingKey: listing.ListingKey || listing.listing_key,
      distressScore: 0,
      dealTypeFlag: 'STANDARD',
      maxHoldingCost: 0,
      targetPrice: listing.ListPrice || 0,
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
 * Process batch for 15-min sync cycle
 * @param {Array} listings - Array of raw listings
 * @param {Object} supabase - Supabase client
 * @param {Object} options - { concurrency, onProgress, etc. }
 * @returns {Object} - { results, errors, stats }
 */
async function processBatch(listings, supabase, options = {}) {
  const concurrency = options.concurrency || 10;
  const results = [];
  const errors = [];
  let processed = 0;
  
  // Process in chunks for concurrency control
  for (let i = 0; i < listings.length; i += concurrency) {
    const chunk = listings.slice(i, i + concurrency);
    
    const chunkResults = await Promise.allSettled(
      chunk.map(listing => processListing(listing, supabase, options))
    );
    
    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        if (result.value.error) {
          errors.push(result.value);
        } else {
          results.push(result.value);
        }
      } else {
        errors.push({
          error: result.reason?.message || 'Unknown error',
          status: 'rejected',
        });
      }
      
      processed++;
    }
    
    // Progress callback
    if (options.onProgress) {
      options.onProgress({ processed, total: listings.length });
    }
  }
  
  return {
    results,
    errors,
    stats: {
      total: listings.length,
      processed,
      successful: results.length,
      failed: errors.length,
    },
  };
}

/**
 * Dual-write to Supabase and Typesense
 */
async function dualWrite(listingMetrics, supabase, typesenseClient) {
  const errors = [];
  
  // Supabase upsert
  if (supabase) {
    try {
      const { error: supabaseError } = await supabase
        .from('properties')
        .upsert({
          listing_key: listingMetrics.listingKey,
          distress_score: listingMetrics.distressScore,
          deal_type_flag: listingMetrics.dealTypeFlag,
          max_holding_cost: listingMetrics.maxHoldingCost,
          target_price: listingMetrics.targetPrice,
          true_price_drop_pct: listingMetrics.truePriceDropPct,
          price_drop_velocity: listingMetrics.priceDropVelocity,
          capital_discount: listingMetrics.capitalDiscount,
          peak_price: listingMetrics.peakPrice,
        }, {
          onConflict: 'listing_key',
        });
      
      if (supabaseError) {
        errors.push({ source: 'supabase', error: supabaseError.message });
      }
    } catch (err) {
      errors.push({ source: 'supabase', error: err.message });
    }
  }
  
  // Typesense upsert
  if (typesenseClient) {
    try {
      // Note: This assumes typesenseClient has the proper typesense SDK instance
      // In production, you'd use the actual Typesense SDK upsert method
      const doc = {
        id: listingMetrics.listingKey,
        distress_score: listingMetrics.distressScore,
        deal_type_flag: listingMetrics.dealTypeFlag,
        max_holding_cost: listingMetrics.maxHoldingCost,
        true_price_drop_pct: listingMetrics.truePriceDropPct,
        price_drop_velocity: listingMetrics.priceDropVelocity,
      };
      
      await typesenseClient.collections('listings').documents.upsert(doc);
    } catch (err) {
      errors.push({ source: 'typesense', error: err.message });
    }
  }
  
  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Run ETL pipeline for a batch of listings
 */
async function runETLPipeline(listings, supabase, typesenseClient, options = {}) {
  console.log(`[ETLPipeline] Starting pipeline for ${listings.length} listings`);
  
  const startTime = Date.now();
  
  // Process batch through all engines
  const { results, errors, stats } = await processBatch(listings, supabase, {
    concurrency: options.concurrency || 10,
    onProgress: options.onProgress,
    trueDom: options.trueDom,
  });
  
  // Dual-write results
  const writeResults = [];
  for (const result of results) {
    const writeResult = await dualWrite(result, supabase, typesenseClient);
    writeResults.push({
      ...result,
      ...writeResult,
    });
  }
  
  const duration = Date.now() - startTime;
  
  console.log(`[ETLPipeline] Pipeline complete in ${duration}ms`);
  console.log(`[ETLPipeline] Stats:`, stats);
  
  return {
    results: writeResults,
    errors,
    stats: {
      ...stats,
      duration,
    },
  };
}

module.exports = {
  ETLPipeline: {
    processListing,
    processBatch,
    dualWrite,
    runETLPipeline,
  },
  mergeDistressResults,
  generatePID,
};