/**
 * BuilderAnalyticsEngine.js - ETL Processing for Land/Builder Properties
 * Processes raw MLS data into builder metadata for development analysis
 */

/**
 * Main entry point for processing a single builder property
 * @param {Object} rawJson - Raw MLS listing data
 * @returns {Object} Processed builder metrics
 */
function processBuilderMetrics(rawJson) {
  // ==========================================================================
  // 1. Geometric Ground Truth
  // ==========================================================================
  const lotWidth = parseFloat(rawJson.LotWidth) || 0;
  const lotDepth = parseFloat(rawJson.LotDepth) || 0;
  const calculatedLotSqft = lotWidth * lotDepth;

  // Edge Case: Irregular Lots
  const lotConfidence = rawJson.LotIrregularities ? "LOW" : "MEDIUM";

  // ==========================================================================
  // 2. Infrastructure Killswitch
  // ==========================================================================
  const waterStatus = rawJson.Water || "";
  const sewerStatus = rawJson.Sewer || "";

  let infrastructureFlag = "OK";
  if (waterStatus !== "Municipal" || !sewerStatus.includes("Sewer")) {
    infrastructureFlag = "SEPTIC/WELL_RISK";
  }

  // ==========================================================================
  // 3. Covered Land / Tear-Down Detector
  // ==========================================================================
  const ageProxy = rawJson.ApproximateAge || "";
  const isOldStructure = ageProxy === "100+" || ageProxy === "51-99";

  const remarks = [rawJson.PublicRemarks, rawJson.PublicRemarksExtras].join(" ");
  const tearDownRegex = /(land value|tear down|teardown|build your dream home|attention builders|builder's opportunity|lot value|as is where is|fixer upper)/i;
  const hasBuilderKeywords = tearDownRegex.test(remarks);

  const distressScore = rawJson.DistressScore || 0;

  const isCoveredLand = hasBuilderKeywords || (isOldStructure && distressScore > 50);

  // ==========================================================================
  // 4. Severance Candidate Scoring
  // ==========================================================================
  let severanceCandidate = false;
  let densityPlay = "none";

  if (lotWidth >= 80 && lotDepth >= 100 && infrastructureFlag === "OK") {
    severanceCandidate = true;
  }

  if (lotWidth >= 120) {
    densityPlay = "HIGH";
  } else if (lotWidth >= 80) {
    densityPlay = "MEDIUM";
  } else if (lotWidth >= 50) {
    densityPlay = "LOW";
  }

  // ==========================================================================
  // 5. Price Per SqFt Calculation
  // ==========================================================================
  let calculatedPpsf = null;
  const livingAreaRange = rawJson.LivingAreaRange || "";

  if (livingAreaRange) {
    const match = livingAreaRange.match(/(\d+)-(\d+)/);
    if (match) {
      const low = parseFloat(match[1]);
      const high = parseFloat(match[2]);
      const midpoint = (low + high) / 2;
      calculatedPpsf = rawJson.ListPrice / midpoint;
    }
  }
  // If no range, set to null - do NOT guess from lot area

  // ==========================================================================
  // 6. Return Processed Object
  // ==========================================================================
  return {
    lot_width_ft: lotWidth,
    lot_depth_ft: lotDepth,
    lot_area_sqft: calculatedLotSqft,
    lot_confidence: lotConfidence,
    infrastructure_flag: infrastructureFlag,
    is_covered_land: isCoveredLand,
    severance_candidate: severanceCandidate,
    density_play: densityPlay,
    price_per_sqft: calculatedPpsf,
    
    // Map to existing builder metadata fields
    pricePerSqFt: calculatedPpsf,
    lotDimensions: {
      width: lotWidth,
      depth: lotDepth,
      areaSqFt: calculatedLotSqft,
      acres: parseFloat((calculatedLotSqft / 43560).toFixed(2))
    },
    sewerStatus: sewerStatus.includes("Sewer") ? "municipal" : "septic",
    waterStatus: waterStatus === "Municipal" ? "municipal" : (waterStatus.toLowerCase().includes("well") ? "well" : "none"),
    zoningDesignation: rawJson.Zoning || "",
    isCoveredLand,
    multiplexByRight: false, // Calculated separately based on zoning
    aduEligible: false,
    gardenSuiteEligible: false
  };
}

/**
 * Batch process multiple listings
 * @param {Array} listings - Array of raw MLS listing objects
 * @returns {Object} { processed: [], failed: [] }
 */
function processBatch(listings) {
  const processed = [];
  const failed = [];

  for (const listing of listings) {
    try {
      const result = processBuilderMetrics(listing);
      processed.push(result);
    } catch (error) {
      console.error(`Failed to process listing ${listing.ListingKey || listing.id}:`, error.message);
      failed.push({
        listing: listing.ListingKey || listing.id,
        reason: error.message
      });
    }
  }

  if (failed.length > 0) {
    console.warn(`Batch processing complete: ${processed.length} succeeded, ${failed.length} failed`);
  }

  return { processed, failed };
}

/**
 * Serialize processed metrics for Typesense indexing
 * @param {Object} processed - Processed builder metrics object
 * @returns {Object} Typesense-compatible field names
 */
function serializeForTypesense(processed) {
  return {
    lot_width_ft: processed.lot_width_ft || 0,
    lot_depth_ft: processed.lot_depth_ft || 0,
    lot_area_sqft: processed.lot_area_sqft || 0,
    is_covered_land: processed.is_covered_land || false,
    severance_candidate: processed.severance_candidate || false,
    infrastructure_flag: processed.infrastructure_flag || "OK",
    density_play: processed.density_play || "none",
    price_per_sqft: processed.price_per_sqft || null,
    
    // Nested object serialization for Typesense
    lot_dimensions: {
      width: processed.lotDimensions?.width || 0,
      depth: processed.lotDimensions?.depth || 0,
      area_sqft: processed.lotDimensions?.areaSqFt || 0,
      acres: processed.lotDimensions?.acres || 0
    },
    
    // Utility status mapping
    sewer_status: processed.sewerStatus || "unknown",
    water_status: processed.waterStatus || "unknown",
    
    // Flag fields
    zoning_designation: processed.zoningDesignation || "",
    multiplex_by_right: processed.multiplexByRight || false,
    adu_eligible: processed.aduEligible || false,
    garden_suite_eligible: processed.gardenSuiteEligible || false,
    is_covered_land: processed.isCoveredLand || false,
    severance_candidate: processed.severance_candidate || false
  };
}

// Export for use in other modules
module.exports = {
  processBuilderMetrics,
  processBatch,
  serializeForTypesense
};