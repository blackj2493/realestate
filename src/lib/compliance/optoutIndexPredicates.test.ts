import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INTERNET_DISPLAY_FIELD, INTERNET_ADDRESS_FIELD } from "./internetDisplay";

// The daily opt-out purge reads only the opted-out rows through migration 159's
// partial indexes. Postgres uses a partial index only when the query's WHERE matches
// the index predicate, so the script and the migration must say the same thing.
const root = join(__dirname, "..", "..", "..");
const migration = readFileSync(join(root, "supabase/migrations/159_optout_partial_indexes.sql"), "utf8");
const script = readFileSync(join(root, "scripts/admin/purgeInternetDisplayOptOuts.ts"), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("opt-out purge ↔ migration 159 partial indexes", () => {
  it("the field names are the ones the purge reads", () => {
    expect(INTERNET_DISPLAY_FIELD).toBe("InternetEntireListingDisplayYN");
    expect(INTERNET_ADDRESS_FIELD).toBe("InternetAddressDisplayYN");
  });

  it("the migration indexes the exact predicates the script builds", () => {
    const m = squash(migration);
    expect(m).toContain(`WHERE full_payload->>'${INTERNET_DISPLAY_FIELD}' = 'false';`);
    expect(m).toContain(
      `WHERE raw_payload->>'${INTERNET_DISPLAY_FIELD}' = 'false' OR raw_payload->>'${INTERNET_ADDRESS_FIELD}' = 'false';`
    );
  });

  it("the script still builds them as literal SQL, not bound parameters", () => {
    const s = squash(script);
    expect(s).toContain("`${payloadColumn}->>'${INTERNET_DISPLAY_FIELD}' = 'false' or ${payloadColumn}->>'${INTERNET_ADDRESS_FIELD}' = 'false'`");
    expect(s).toContain("`${payloadColumn}->>'${INTERNET_DISPLAY_FIELD}' = 'false'`");
    expect(s).toContain("optedOutKeys(c, 'listings', 'full_payload', false)");
    expect(s).toContain("optedOutKeys(c, 'raw_vow_sold', 'raw_payload', true)");
  });
});
