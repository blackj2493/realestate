/**
 * Reader for the Census 2021 profile extract (extractProfile.ts output, NDJSON). Shared by
 * loadCensus.ts (DA facts) and loadCommunities.ts (community facts).
 */
import * as fs from "fs";
import * as readline from "readline";
import type { ProfileValues } from "@/lib/census/areaFacts";

interface ProfileRow {
  dguid: string;
  level: string;
  code: string;
  name: string;
  v: ProfileValues;
}

/** "Toronto, City (C)" → "Toronto"; "Whitchurch-Stouffville, Town (T)" → "Whitchurch-Stouffville". */
export function cityName(geoName: string): string {
  return geoName.replace(/,\s[^,]+\s\([A-Z-]+\)$/, "").trim();
}

/**
 * DA and CSD rows, in the file's nesting order, so each DA belongs to the CSD row above it.
 */
export async function readProfile(file: string) {
  const da = new Map<string, { csd: string; v: ProfileValues }>();
  const csd = new Map<string, { name: string; v: ProfileValues }>();
  let curCsd: string | null = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line) as ProfileRow;
    if (r.level === "Census subdivision") {
      curCsd = r.code;
      csd.set(r.code, { name: cityName(r.name), v: r.v });
    } else if (r.level === "Dissemination area") {
      if (!curCsd) throw new Error(`DA ${r.code} before any CSD row`);
      da.set(r.code, { csd: curCsd, v: r.v });
    }
  }
  return { da, csd };
}
