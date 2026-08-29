/**
 * AVM CSV Ingestion Script (Path A — interpretable per-market model)
 *
 * Loads the per-market matrices and the master audit report into the app-owned
 * Supabase tables:
 *   • avm_multiplier_matrix  — per feature: beta, feat_mean, feat_std
 *   • avm_audit_report       — per market: R², MAE, total sales, base_price
 *
 * Both tables are WIPED before reload (they are fully regenerable from the CSVs;
 * a clean slate prevents stale rows from a prior export shadowing the new keys).
 *
 * Usage: npx tsx scripts/worker/avm/ingest-matrices.ts
 * Place the CSV files in scripts/worker/avm/data/.
 *
 * Matrix CSV columns: City_Region, Property_Type, Feature, Beta, Mean, StdDev
 * Audit  CSV columns: City_Region, Property_Type, Total_Sales_Analyzed,
 *                     Model_Accuracy_Score (R2), Average_Error_Margin, Base_Price, File_Name
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Quote-aware CSV parsing ─────────────────────────────────────────────────
// pandas to_csv quotes any field containing a comma (e.g. a city region), so a
// naive split(',') would misalign columns. This respects "double quoted" fields
// and the "" escape.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

// ── Configuration ────────────────────────────────────────────────────────────
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const DATA_DIR = path.join(__dirname, 'data');
const BATCH = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// The 8 model features, in canonical snake_case (matches the CSV Feature column
// and the score conventions in src/lib/avm/calculator.ts).
const ALLOWED_FEATURES = new Set([
  'building_area_total',
  'lot_width',
  'bedrooms_above_grade',
  'bathrooms_total_integer',
  'parking_total',
  'basement_score',
  'interior_score',
  'exterior_score',
]);

// ── Types ─────────────────────────────────────────────────────────────────────
interface AuditRecord {
  city_region: string;
  property_sub_type: string;
  total_sales_analyzed: number;
  model_accuracy_score: number;
  average_error_margin: number;
  base_price: number | null;
}

interface MatrixRecord {
  city_region: string;
  property_sub_type: string;
  feature_name: string;
  beta: number;
  feat_mean: number;
  feat_std: number;
}

// ── Row parsers ─────────────────────────────────────────────────────────────
function num(raw: string | undefined): number {
  return parseFloat(String(raw ?? '').replace(/[$,]/g, ''));
}

function parseMatrixRow(row: Record<string, string>): MatrixRecord | null {
  const cityRegion = (row['City_Region'] || '').trim();
  const propertySubType = (row['Property_Type'] || '').trim();
  const featureName = (row['Feature'] || '').trim().toLowerCase();

  if (!cityRegion || !propertySubType || !ALLOWED_FEATURES.has(featureName)) return null;

  const beta = num(row['Beta']);
  const feat_mean = num(row['Mean']);
  let feat_std = num(row['StdDev']);

  if (!Number.isFinite(beta) || !Number.isFinite(feat_mean) || !Number.isFinite(feat_std)) {
    console.warn(`[INGEST] Skipping matrix row with non-numeric data: ${JSON.stringify(row)}`);
    return null;
  }
  // Guard against divide-by-zero at request time.
  if (feat_std <= 0) feat_std = 1;

  return { city_region: cityRegion, property_sub_type: propertySubType, feature_name: featureName, beta, feat_mean, feat_std };
}

function parseAuditRow(row: Record<string, string>): AuditRecord | null {
  const cityRegion = (row['City_Region'] || row['city_region'] || '').trim();
  const propertySubType = (row['Property_Type'] || row['property_type'] || '').trim();
  if (!cityRegion || !propertySubType) {
    console.warn(`[INGEST] Skipping audit row missing region/type: ${JSON.stringify(row)}`);
    return null;
  }

  const totalSales = parseInt((row['Total_Sales_Analyzed'] || '0').trim(), 10);
  const modelAccuracy = num(row['Model_Accuracy_Score (R2)'] || row['Model_Accuracy_Score'] || '0');
  const avgErrorMargin = num(row['Average_Error_Margin'] || '0');
  const basePriceRaw = num(row['Base_Price']);
  const base_price = Number.isFinite(basePriceRaw) && basePriceRaw > 0 ? basePriceRaw : null;

  if (!Number.isFinite(totalSales) || !Number.isFinite(modelAccuracy)) {
    console.warn(`[INGEST] Skipping audit row with invalid data: ${JSON.stringify(row)}`);
    return null;
  }

  return {
    city_region: cityRegion,
    property_sub_type: propertySubType,
    total_sales_analyzed: totalSales,
    model_accuracy_score: modelAccuracy,
    average_error_margin: Number.isFinite(avgErrorMargin) ? avgErrorMargin : 0,
    base_price,
  };
}

// ── File discovery ──────────────────────────────────────────────────────────
function findCsvFiles(dir: string): { auditFiles: string[]; matrixFiles: string[] } {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const auditFiles: string[] = [];
  const matrixFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.csv')) {
      const lower = entry.name.toLowerCase();
      if (lower.includes('audit') || lower.includes('report')) auditFiles.push(path.join(dir, entry.name));
      else if (lower.includes('matrix') || lower.includes('multiplier')) matrixFiles.push(path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      const sub = findCsvFiles(path.join(dir, entry.name));
      auditFiles.push(...sub.auditFiles);
      matrixFiles.push(...sub.matrixFiles);
    }
  }
  return { auditFiles, matrixFiles };
}

// ── DB helpers ──────────────────────────────────────────────────────────────
async function wipeTable(table: string): Promise<void> {
  // id is SERIAL (>= 1); gte 0 matches every row.
  const { error } = await supabase.from(table).delete().gte('id', 0);
  if (error) {
    console.error(`[INGEST] Failed to wipe ${table}:`, error.message);
    throw error;
  }
  console.log(`[INGEST] Wiped ${table}`);
}

async function insertBatched<T extends object>(table: string, rows: T[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from(table).insert(slice).select();
    if (error) {
      console.error(`[INGEST] Insert error into ${table} (batch @${i}):`, error.message);
      throw error;
    }
    inserted += data?.length ?? 0;
  }
  return inserted;
}

// ── Ingestion ───────────────────────────────────────────────────────────────
async function ingestAuditReports(auditFiles: string[]): Promise<number> {
  const records: AuditRecord[] = [];
  for (const file of auditFiles) {
    const rows = parseCsv(fs.readFileSync(file, 'utf-8'));
    for (const row of rows) {
      const rec = parseAuditRow(row);
      if (rec) records.push(rec);
    }
  }
  if (records.length === 0) {
    console.log('[INGEST] No audit records to insert');
    return 0;
  }
  const n = await insertBatched('avm_audit_report', records);
  console.log(`[INGEST] Inserted ${n} audit records`);
  return n;
}

async function ingestMultiplierMatrices(matrixFiles: string[]): Promise<number> {
  const records: MatrixRecord[] = [];
  for (const file of matrixFiles) {
    const rows = parseCsv(fs.readFileSync(file, 'utf-8'));
    for (const row of rows) {
      const rec = parseMatrixRow(row);
      if (rec) records.push(rec);
    }
  }
  if (records.length === 0) {
    console.log('[INGEST] No matrix records to insert');
    return 0;
  }
  const n = await insertBatched('avm_multiplier_matrix', records);
  console.log(`[INGEST] Inserted ${n} matrix records`);
  return n;
}

// ── Verification ────────────────────────────────────────────────────────────
async function verifyTables(): Promise<void> {
  const { count: auditCount } = await supabase
    .from('avm_audit_report')
    .select('*', { count: 'exact', head: true });
  const { count: matrixCount } = await supabase
    .from('avm_multiplier_matrix')
    .select('*', { count: 'exact', head: true });

  const { data: sample } = await supabase
    .from('avm_multiplier_matrix')
    .select('cohort_rung, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std')
    .limit(10);

  console.log('\n[VERIFY] Matrix sample:');
  console.table(sample);
  console.log(`[VERIFY] Total audit records: ${auditCount}`);
  console.log(`[VERIFY] Total matrix records: ${matrixCount}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[INGEST] AVM CSV Ingestion (Path A)');
  console.log('[INGEST] Data directory:', DATA_DIR);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[INGEST] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(DATA_DIR)) {
    console.error('[INGEST] Data directory not found:', DATA_DIR);
    process.exit(1);
  }

  const { auditFiles, matrixFiles } = findCsvFiles(DATA_DIR);
  console.log(`[INGEST] Found ${auditFiles.length} audit CSV(s), ${matrixFiles.length} matrix CSV(s)`);
  if (auditFiles.length === 0 && matrixFiles.length === 0) {
    console.warn('[INGEST] No CSV files found in', DATA_DIR);
    process.exit(0);
  }

  try {
    await wipeTable('avm_multiplier_matrix');
    await wipeTable('avm_audit_report');
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
