import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The upsert record in sync.ts is a hand-written object literal, and what it omits is
 * what silently never reaches the table. It has now dropped a column TWICE:
 *
 *  • `transaction_type` after migration 104 — ~1,000 rows/day went missing from every
 *    comparable set for 12 days (the ingester's own header records this).
 *  • `sitemap_path` after migration 138 (#491) — the backfill filled all 308,951 rows on
 *    2026-09-04; by 2026-09-24, 36,797 carried NULL again, the newest written that
 *    morning. A quarter of the listing sitemap had regressed to non-canonical
 *    /properties/{KEY} URLs.
 *
 * Both were invisible: the sync logs success, the column just holds NULL. A type cannot
 * catch it — the literal is anonymous and every field is optional-shaped to the DB — so
 * this compares the two sources directly. If you add a field to TransformResult's
 * supabasePayload, add it to the upsert too, or say here why it is deliberately excluded.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function payloadKeys(): string[] {
  const src = read("scripts/worker/transformer.ts");
  const start = src.indexOf("  supabasePayload: {");
  const block = src.slice(start, src.indexOf("\n  };", start));
  return [...block.matchAll(/^\s{4}(\w+)\s*\??:/gm)].map((m) => m[1]);
}

function upsertKeys(): string[] {
  const src = read("scripts/worker/sync.ts");
  const start = src.indexOf("const supabaseRecords = transformed.map");
  const block = src.slice(start, src.indexOf("\n  });", start));
  return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

describe("sync.ts writes every column the transformer computes", () => {
  it("omits nothing from TransformResult.supabasePayload", () => {
    const missing = payloadKeys().filter((k) => !upsertKeys().includes(k));
    expect(missing).toEqual([]);
  });

  it("carries sitemap_path specifically", () => {
    // Named on its own because its absence is silent twice over: the sync succeeds, and
    // the sitemap still emits a URL — just the legacy, non-canonical one.
    expect(upsertKeys()).toContain("sitemap_path");
  });

  it("finds real keys in both files, so a rename cannot make this pass vacuously", () => {
    expect(payloadKeys().length).toBeGreaterThan(20);
    expect(upsertKeys()).toContain("listing_key");
  });
});
