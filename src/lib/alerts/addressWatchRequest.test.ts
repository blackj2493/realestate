import { describe, expect, it } from "vitest";
import { isMissingRecapColumn, parseRecapChoice, watchConfirmationText } from "./addressWatchRequest";

describe("parseRecapChoice", () => {
  it("keeps an explicit answer, including a decline", () => {
    expect(parseRecapChoice({ recap: true })).toBe(true);
    expect(parseRecapChoice({ recap: false })).toBe(false);
  });

  it("treats a missing or non-boolean answer as never asked", () => {
    expect(parseRecapChoice({})).toBeNull();
    expect(parseRecapChoice({ recap: "true" })).toBeNull();
    expect(parseRecapChoice(null)).toBeNull();
  });
});

describe("isMissingRecapColumn", () => {
  it("recognises the column missing before migration 155", () => {
    expect(
      isMissingRecapColumn({
        code: "PGRST204",
        message: "Could not find the 'recap' column of 'address_watches' in the schema cache",
      })
    ).toBe(true);
    expect(isMissingRecapColumn({ code: "42703", message: 'column "recap" does not exist' })).toBe(true);
  });

  it("does not swallow any other failure", () => {
    expect(isMissingRecapColumn(null)).toBe(false);
    expect(isMissingRecapColumn({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingRecapColumn({ code: "PGRST204", message: "Could not find the 'postal' column" })).toBe(false);
  });
});

describe("watchConfirmationText", () => {
  const base = { where: "12 Main St, Toronto", unsubscribeUrl: "https://example.org/u" };

  it("promises the listing alert, and the monthly note only when chosen", () => {
    const without = watchConfirmationText({ ...base, recap: false });
    expect(without).toContain("We'll email you if this home is listed.");
    expect(without).not.toContain("monthly");

    expect(watchConfirmationText({ ...base, recap: true })).toContain("monthly note");
  });

  it("always carries the unsubscribe link", () => {
    expect(watchConfirmationText({ ...base, recap: true })).toContain(base.unsubscribeUrl);
  });
});
