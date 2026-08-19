/**
 * Guard on the ONE silent failure that undoes the whole beds x type split.
 *
 * Every grid bucket now reads BedroomsAboveGrade + BedroomsBelowGrade. Typesense
 * returns only the fields a query asks for, and a doc missing BedroomsBelowGrade
 * classifies as "no plus-room" — so quietly trimming either name from an
 * `include_fields` list folds 1+den units straight back into the 2 bedroom median.
 * Nothing throws. Nothing logs. The grid just starts lying again.
 */
import { describe, it, expect } from "vitest";
import { CLOSED_NEAR_POINT_FIELDS } from "@/lib/sold/soldByKey";
import { FIELDS as ACTIVE_FIELDS } from "@/lib/address/nearbyForSale";

const REQUIRED = ["BedroomsAboveGrade", "BedroomsBelowGrade"];

describe("Typesense include_fields carry the bed split", () => {
  it("the closed-deal (sold + leased) fetch asks for both bed fields", () => {
    for (const f of REQUIRED) expect(CLOSED_NEAR_POINT_FIELDS.split(",")).toContain(f);
  });

  it("the active (asking) fetch asks for both bed fields", () => {
    for (const f of REQUIRED) expect(ACTIVE_FIELDS.split(",")).toContain(f);
  });
});
