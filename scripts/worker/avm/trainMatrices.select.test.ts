/**
 * The trainer's SQL SELECT and its feature vector are maintained by hand, in the same
 * file, ~140 lines apart. Nothing connects them.
 *
 * On 2026-08-18 that gap shipped a dead feature: bedrooms_below_grade was added to
 * FEATURES, to SoldRow and to featureVec, but NOT to the SELECT. Every row arrived
 * with the field undefined, so std was 0, every beta was exactly 0.0000 across all
 * 1,661 cohorts, and the feature did nothing. Nothing failed. The challenger still
 * backtested, still beat the champion on the strength of a fresher training window
 * (10.52% -> 10.11%), and still cleared the promotion gate — carrying an inert
 * feature into production had it been promoted.
 *
 * This reads the source and asserts the two agree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('scripts/worker/avm/trainMatrices.ts', 'utf8');

/** Columns featureVec pulls off its row, i.e. what the query MUST return. */
function columnsFeatureVecReads(): string[] {
  const body = SRC.slice(SRC.indexOf('function featureVec'), SRC.indexOf('const mean ='));
  return [...new Set([...body.matchAll(/\br\.([a-z_]+)/g)].map((m) => m[1]))];
}

/** Columns the SELECT aliases out. */
function columnsSelected(): string[] {
  const q = SRC.slice(SRC.indexOf('`SELECT listing_key'), SRC.indexOf('FROM raw_vow_sold'));
  return [...new Set([...q.matchAll(/AS\s+([a-z_]+)/g)].map((m) => m[1]))]
    .concat([...q.matchAll(/^\s*([a-z_]+),\s*$/gm)].map((m) => m[1]));
}

describe('trainMatrices: the SELECT feeds every trained feature', () => {
  it('fetches every column featureVec reads', () => {
    const need = columnsFeatureVecReads();
    const have = columnsSelected();
    expect(need.length).toBeGreaterThan(5);           // guard the regex itself
    for (const col of need) {
      expect(have, `SELECT is missing "${col}" — it would train as a constant, beta 0`).toContain(col);
    }
  });

  it('specifically fetches the plus-room column', () => {
    expect(columnsSelected()).toContain('bedrooms_below_grade');
  });

  it('keeps FEATURES and featureVec the same length — they align BY INDEX', () => {
    const feats = SRC.slice(SRC.indexOf('const FEATURES = ['), SRC.indexOf('] as const;'));
    const nFeatures = (feats.match(/'/g)!.length) / 2;
    // Split the returned array on TOP-LEVEL commas only: score(tier, top) carries its
    // own, and a naive split counts those as extra features.
    const start = SRC.indexOf('return [', SRC.indexOf('function featureVec'));
    const arr = SRC.slice(start + 'return ['.length, SRC.indexOf('];', start));
    let depth = 0, nVec = 1;
    for (const ch of arr) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) nVec++;
    }
    if (arr.trim().endsWith(',')) nVec--;   // trailing comma is not an element
    expect(nVec).toBe(nFeatures);
  });

  it('still guards against a feature that trains to beta 0 everywhere', () => {
    expect(SRC).toContain('assertFeaturesTrained');
  });
});
