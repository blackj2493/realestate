/**
 * AVM CSV Ingestion Script
 * 
 * Ingests the multiplier matrices and audit reports from the exported CSVs
 * into the Supabase AVM tables.
 * 
 * Usage: npx tsx scripts/worker/avm/ingest-matrices.ts
 * 
 * The ZIP file (PureProperty_Production_Export.zip) should be placed in:
 * scripts/worker/avm/data/
 * 
 * CSV Column Mapping (per the actual export):
 * - Multiplier CSVs: Feature | Average_Dollar_Impact (Historical) | Percentage_Multiplier (Future-Proof)
 * - Audit CSVs: CityRegion | PropertySubType | total_sales_analyzed | model_accuracy_score | average_error_margin
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

/**
 * Simple CSV parser — parses CSV content into an array of objects with keys from the header row.
 */
function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }

  return rows;
}

// ── Configuration ────────────────────────────────────────────────────────────
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DATA_DIR = path.join(__dirname, 'data');

// ── Supabase Client ────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Types ─────────────────────────────────────────────────────────────────────
interface AuditRecord {
  city_region: string;
  property_sub_type: string;
  total_sales_analyzed: number;
  model_accuracy_score: number;
  average_error_margin: number;
}

interface MatrixRecord {
  city_region: string;
  property_sub_type: string;
  feature_name: string;
  dollar_per_unit: number; // stored as cents (integer)
  multiplier: number;
}

// Feature name normalization map (CSV Feature → DB feature_name)
const FEATURE_MAP: Record<string, string> = {
  'bedrooms_above_grade': 'bedrooms_above_grade',
  'bedrooms': 'bedrooms_above_grade',
  'bathrooms_total_integer': 'bathrooms_total_integer',
  'bathrooms': 'bathrooms_total_integer',
  'parking_total': 'parking_total',
  'parking': 'parking_total',
  'interior_score': 'interior_score',
  'exterior_score': 'exterior_score',
  'basement_score': 'basement_score',
};

// ── CSV Parsing Helpers ───────────────────────────────────────────────────────

/**
 * Parse a multiplier CSV row.
 * Columns: Feature | Average_Dollar_Impact (Historical) | Percentage_Multiplier (Future-Proof)
 * 
 * Example row:
 * Feature,Average_Dollar_Impact (Historical),Percentage_Multiplier (Future-Proof)
 * interior_score,$18114,0.0161
 */
function parseMultiplierRow(
  cityRegion: string,
  propertySubType: string,
  row: Record<string, string>
): MatrixRecord | null {
  const featureRaw = (row['Feature'] || row['feature'] || '').trim().toLowerCase();
  const featureName = FEATURE_MAP[featureRaw];

  if (!featureName) {
    // Skip unknown features
    return null;
  }

  // Parse dollar amount — strip $ and , from "Average_Dollar_Impact (Historical)"
  const dollarRaw = (row['Average_Dollar_Impact (Historical)'] || row['Average_Dollar_Impact'] || '$0').replace(/[$,]/g, '');
  const dollarPerUnit = Math.round(parseFloat(dollarRaw) * 100); // Convert to cents

  // Parse the percentage multiplier from "Percentage_Multiplier (Future-Proof)"
  const multiplierRaw = (row['Percentage_Multiplier (Future-Proof)'] || row['Percentage_Multiplier'] || '0').trim();
  const multiplier = parseFloat(multiplierRaw);

  if (isNaN(dollarPerUnit) || isNaN(multiplier)) {
    console.warn(`[INGEST] Skipping row with invalid data: ${JSON.stringify(row)}`);
    return null;
  }

  return {
    city_region: cityRegion,
    property_sub_type: propertySubType,
    feature_name: featureName,
    dollar_per_unit: dollarPerUnit,
    multiplier,
  };
}

/**
 * Parse an audit CSV row.
 * Actual columns: City_Region | Property_Type | Total_Sales_Analyzed | Model_Accuracy_Score (R2) | Average_Error_Margin
 */
function parseAuditRow(row: Record<string, string>): AuditRecord | null {
  const cityRegion = (row['City_Region'] || row['city_region'] || '').trim();
  const propertySubType = (row['Property_Type'] || row['property_type'] || '').trim();

  if (!cityRegion || !propertySubType) {
    console.warn(`[INGEST] Skipping audit row missing region/type: ${JSON.stringify(row)}`);
    return null;
  }

  const totalSales = parseInt((row['Total_Sales_Analyzed'] || row['total_sales_analyzed'] || '0').trim(), 10);
  const r2Col = row['Model_Accuracy_Score (R2)'] || row['model_accuracy_score'] || '0';
  const modelAccuracy = parseFloat(r2Col.trim());
  const avgErrorMargin = parseFloat((row['Average_Error_Margin'] || row['average_error_margin'] || '0').trim());

  if (isNaN(totalSales) || isNaN(modelAccuracy)) {
    console.warn(`[INGEST] Skipping audit row with invalid data: ${JSON.stringify(row)}`);
    return null;
  }

  return {
    city_region: cityRegion,
    property_sub_type: propertySubType,
    total_sales_analyzed: totalSales,
    model_accuracy_score: modelAccuracy,
    average_error_margin: avgErrorMargin,
  };
}

// ── File Discovery ────────────────────────────────────────────────────────────

function findCsvFiles(dir: string): { auditFiles: string[]; matrixFiles: string[] } {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const auditFiles: string[] = [];
  const matrixFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.csv')) {
      const lower = entry.name.toLowerCase();
      if (lower.includes('audit') || lower.includes('report')) {
        auditFiles.push(path.join(dir, entry.name));
      } else if (lower.includes('matrix') || lower.includes('multiplier')) {
        matrixFiles.push(path.join(dir, entry.name));
      }
    } else if (entry.isDirectory()) {
      const subresult = findCsvFiles(path.join(dir, entry.name));
      auditFiles.push(...subresult.auditFiles);
      matrixFiles.push(...subresult.matrixFiles);
    }
  }

  return { auditFiles, matrixFiles };
}

/**
 * Bulletproof filename parser for AVM matrix CSVs.
 *
 * Filename format: {CityRegion}_{PropertyType}_Matrix.csv
 *
 * Examples:
 *   Waterfront_C1_Condo_Apartment_Matrix.csv  →  cityRegion: "Waterfront C1",  propertySubType: "Condo Apartment"
 *   Bay_Street_Corridor_Detached_Matrix.csv    →  cityRegion: "Bay Street Corridor",  propertySubType: "Detached"
 *   Maple_Townhouse_Matrix.csv                →  cityRegion: "Maple",  propertySubType: "Townhouse"
 *   057_-_Smithville_Semi-Detached_Matrix.csv →  cityRegion: "057 - Smithville", propertySubType: "Semi-Detached"
 *
 * Property types are ALWAYS one of: Detached | Semi-Detached | Townhouse | Condo_Apartment
 * These appear as underscores in the filename, NOT spaces.
 *
 * Strategy: search the filename for those exact strings, everything before is the city.
 * Then replace underscores in both parts with spaces to reconstruct the true names.
 */
const PROPERTY_TYPES = ['Detached', 'Semi-Detached', 'Townhouse', 'Condo_Apartment'];

function extractMarketFromFilename(filename: string): { cityRegion: string; propertySubType: string } {
  const basename = path.basename(filename, '.csv').toLowerCase();

  // Find which property type appears in this filename
  let propertySubTypeRaw = '';
  for (const pt of PROPERTY_TYPES) {
    const ptLower = pt.toLowerCase(); // 'condo_apartment'
    const ptSearch = ptLower;         // 'condo_apartment'
    if (basename.includes(ptSearch)) {
      // Reconstruct the raw property type as it appears in the filename (before _Matrix)
      // e.g. "Waterfront_C1_Condo_Apartment" — find "Condo_Apartment" and use it
      const idx = basename.indexOf(ptSearch);
      // Grab the segment containing the property type: e.g. "Waterfront_C1_Condo_Apartment"
      const segment = basename.substring(0, idx + ptSearch.length);
      // Last token of the segment = the property type token (e.g. "Condo_Apartment")
      const tokens = segment.split('_').filter(Boolean);
      propertySubTypeRaw = tokens[tokens.length - 1] || ptLower;
      break;
    }
  }

  if (!propertySubTypeRaw) {
    console.warn(`[INGEST] Could not detect property type in filename: ${filename}`);
    return { cityRegion: basename.replace(/_/g, ' '), propertySubType: '' };
  }

  // Build the propertySubType by replacing underscores with spaces
  const propertySubType = propertySubTypeRaw.replace(/_/g, ' ');

  // Everything before the property type token is the city region
  // e.g. "Waterfront_C1" from "Waterfront_C1_Condo_Apartment"
  // Find the city segment by locating the property type token within the basename
  const propertyTokenIndex = basename.indexOf(propertySubTypeRaw);
  const citySegment = basename.substring(0, propertyTokenIndex).replace(/_matrix$/, '').replace(/_$/, '');
  const cityRegion = citySegment.replace(/_/g, ' ').trim();

  return { cityRegion, propertySubType };
}

// ── Database Ingestion ────────────────────────────────────────────────────────

async function ingestAuditReports(auditFiles: string[]): Promise<number> {
  const records: AuditRecord[] = [];

  for (const file of auditFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const rows = parseCsv(content);

    for (const row of rows) {
      const record = parseAuditRow(row as Record<string, string>);
      if (record) {
        records.push(record);
      }
    }
  }

  if (records.length === 0) {
    console.log('[INGEST] No audit records to insert');
    return 0;
  }

  const { data, error } = await supabase
    .from('avm_audit_report')
    .upsert(records, { onConflict: 'city_region,property_sub_type' })
    .select();

  if (error) {
    console.error('[INGEST] Audit insert error:', error.message);
    throw error;
  }

  console.log(`[INGEST] Inserted ${data?.length ?? 0} audit records`);
  return data?.length ?? 0;
}

async function ingestMultiplierMatrices(matrixFiles: string[]): Promise<number> {
  const records: MatrixRecord[] = [];

  for (const file of matrixFiles) {
    const { cityRegion, propertySubType } = extractMarketFromFilename(file);
    const content = fs.readFileSync(file, 'utf-8');
    const rows = parseCsv(content);

    for (const row of rows) {
      const record = parseMultiplierRow(cityRegion, propertySubType, row as Record<string, string>);
      if (record) {
        records.push(record);
      }
    }
  }

  if (records.length === 0) {
    console.log('[INGEST] No matrix records to insert');
    return 0;
  }

  // Deduplicate by composite key — keep first occurrence
  const seen = new Set<string>();
  const unique: MatrixRecord[] = [];
  for (const r of records) {
    const key = `${r.city_region}::${r.property_sub_type}::${r.feature_name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  console.log(`[INGEST] Deduped ${records.length} → ${unique.length} matrix records`);

  const { data, error } = await supabase
    .from('avm_multiplier_matrix')
    .upsert(unique, { onConflict: 'city_region,property_sub_type,feature_name' })
    .select();

  if (error) {
    console.error('[INGEST] Matrix insert error:', error.message);
    throw error;
  }

  console.log(`[INGEST] Inserted ${data?.length ?? 0} matrix records`);
  return data?.length ?? 0;
}

// ── Verification ───────────────────────────────────────────────────────────────

async function verifyTables(): Promise<void> {
  const { data: auditData, error: auditError } = await supabase
    .from('avm_audit_report')
    .select('city_region, property_sub_type, model_accuracy_score')
    .limit(10);

  const { data: matrixData, error: matrixError } = await supabase
    .from('avm_multiplier_matrix')
    .select('city_region, property_sub_type, feature_name, multiplier')
    .limit(10);

  console.log('\n[VERIFY] AVM Audit Report sample:');
  if (auditError) {
    console.error('[VERIFY] Error fetching audit:', auditError.message);
  } else {
    console.table(auditData);
  }

  console.log('\n[VERIFY] AVM Multiplier Matrix sample:');
  if (matrixError) {
    console.error('[VERIFY] Error fetching matrix:', matrixError.message);
  } else {
    console.table(matrixData);
  }

  // Row counts
  const { count: auditCount } = await supabase
    .from('avm_audit_report')
    .select('*', { count: 'exact', head: true });

  const { count: matrixCount } = await supabase
    .from('avm_multiplier_matrix')
    .select('*', { count: 'exact', head: true });

  console.log(`\n[VERIFY] Total audit records: ${auditCount}`);
  console.log(`[VERIFY] Total matrix records: ${matrixCount}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[INGEST] AVM CSV Ingestion Script');
  console.log('[INGEST] Data directory:', DATA_DIR);

  if (!fs.existsSync(DATA_DIR)) {
    console.error('[INGEST] Data directory not found:', DATA_DIR);
    process.exit(1);
  }

  // Check for ZIP file and extract if present
  const zipFile = path.join(DATA_DIR, 'PureProperty_Production_Export.zip');
  if (fs.existsSync(zipFile)) {
    console.log('[INGEST] Found ZIP file, extracting...');
    // Note: In a full implementation, use yauzl or similar for ZIP extraction
    console.log('[INGEST] ZIP extraction not yet implemented — place CSV files directly in data/');
  }

  const { auditFiles, matrixFiles } = findCsvFiles(DATA_DIR);

  console.log(`[INGEST] Found ${auditFiles.length} audit CSV(s):`, auditFiles);
  console.log(`[INGEST] Found ${matrixFiles.length} matrix CSV(s):`, matrixFiles);

  // Pre-flight: show parsed city/region for first 5 matrix files
  console.log('\n[INGEST] Parser pre-check (first 5 matrix files):');
  matrixFiles.slice(0, 5).forEach((f) => {
    const { cityRegion, propertySubType } = extractMarketFromFilename(f);
    console.log(`   ${path.basename(f)}\n      → cityRegion: "${cityRegion}"  propertySubType: "${propertySubType}"`);
  });
  console.log();

  if (auditFiles.length === 0 && matrixFiles.length === 0) {
    console.warn('[INGEST] No CSV files found. Place CSV files in:', DATA_DIR);
    process.exit(0);
  }

  try {
    await ingestAuditReports(auditFiles);
    await ingestMultiplierMatrices(matrixFiles);
    await verifyTables();
    console.log('\n[INGEST] Ingestion complete!');
  } catch (err) {
    console.error('[INGEST] Fatal error:', err);
    process.exit(1);
  }
}

main();