/**
 * extractProfile — cut the Census 2021 Profile (98-401-X2021006, ~8.8 GB for Ontario) down
 * to the few characteristics the area card uses, for every dissemination area (DA) and every
 * census subdivision (CSD, the "compared with Toronto" baseline).
 *
 * Streams stdin, so the zip never has to be unpacked:
 *   unzip -p 98-401-X2021006_eng_CSV.zip 98-401-X2021006_English_CSV_data_Ontario.csv \
 *     | npx tsx scripts/worker/census/extractProfile.ts > data/census/profile_on.ndjson
 *
 * Output: one JSON line per geography: { dguid, level, code, name, v: { <charId>: [count, rate] } }.
 *
 * COMPLIANCE: Statistics Canada Open Licence (attribution required, carried on the card).
 * Only facts about PLACES are kept: dwellings, tenure, costs, commute, mobility, income.
 * Nothing about protected grounds under the Ontario Human Rights Code (age, family status,
 * ethnic origin, citizenship, language, religion, receipt of public assistance — so the
 * "% in subsidized housing" row is left out on purpose).
 */

import * as readline from "readline";
import { CENSUS_CHAR_IDS } from "@/lib/census/characteristics";

const KEEP = new Set<number>(CENSUS_CHAR_IDS);
const LEVELS = new Set(["Dissemination area", "Census subdivision", "Province"]);

/** Minimal CSV line split (the file quotes text fields; numbers are bare). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let header: string[] | null = null;
  let iDguid = 0, iCode = 0, iLevel = 0, iName = 0, iChar = 0, iCount = 0, iRate = 0;
  let cur: { dguid: string; level: string; code: string; name: string; v: Record<number, [number | null, number | null]> } | null = null;
  let rows = 0;
  let geos = 0;
  const flush = () => {
    if (cur && LEVELS.has(cur.level)) {
      process.stdout.write(JSON.stringify(cur) + "\n");
      geos++;
    }
  };
  for await (const line of rl) {
    if (!header) {
      header = splitCsv(line.replace(/^﻿/, ""));
      iDguid = header.indexOf("DGUID");
      iCode = header.indexOf("ALT_GEO_CODE");
      iLevel = header.indexOf("GEO_LEVEL");
      iName = header.indexOf("GEO_NAME");
      iChar = header.indexOf("CHARACTERISTIC_ID");
      iCount = header.indexOf("C1_COUNT_TOTAL");
      iRate = header.indexOf("C10_RATE_TOTAL");
      if ([iDguid, iCode, iLevel, iName, iChar, iCount, iRate].some((i) => i < 0)) throw new Error(`unexpected header: ${line}`);
      continue;
    }
    rows++;
    // Cheap pre-filter: the characteristic id is the 9th field; skip most rows unparsed.
    const f = splitCsv(line);
    const dguid = f[iDguid];
    if (!cur || cur.dguid !== dguid) {
      flush();
      cur = { dguid, level: f[iLevel], code: f[iCode], name: f[iName], v: {} };
    }
    if (!LEVELS.has(cur.level)) continue;
    const id = Number(f[iChar]);
    if (KEEP.has(id)) cur.v[id] = [num(f[iCount]), num(f[iRate])];
    if (rows % 5_000_000 === 0) process.stderr.write(`  ${rows.toLocaleString()} rows, ${geos} geographies\n`);
  }
  flush();
  process.stderr.write(`done: ${rows.toLocaleString()} rows, ${geos} geographies\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
