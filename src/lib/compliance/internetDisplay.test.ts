import { describe, it, expect } from "vitest";
import {
  isListingDisplayOptedOut,
  isAddressDisplayOptedOut,
  isAnyInternetDisplayOptedOut,
  isOptedOutValue,
} from "./internetDisplay";

describe("internet-display opt-out", () => {
  describe("only an explicit No suppresses", () => {
    it("treats a missing field as NOT opted out", () => {
      // The load-bearing case. If absent ever coerced to "opted out", the gates
      // would empty the index — 887 of 304,820 rows carry the flag as false, and
      // an early bug here would have hidden the other 303,931.
      expect(isListingDisplayOptedOut({})).toBe(false);
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: undefined })).toBe(false);
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: null })).toBe(false);
    });

    it("treats a null or undefined payload as NOT opted out", () => {
      expect(isListingDisplayOptedOut(null)).toBe(false);
      expect(isListingDisplayOptedOut(undefined)).toBe(false);
      expect(isListingDisplayOptedOut("not a payload")).toBe(false);
    });

    it("suppresses on the feed's boolean false", () => {
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: false })).toBe(true);
    });

    it("does not suppress on boolean true", () => {
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: true })).toBe(false);
    });
  });

  describe("string spellings from dirty and PostgREST-extracted payloads", () => {
    // `raw_payload->>'InternetEntireListingDisplayYN'` returns the STRING 'false',
    // never a boolean, so the string arm is a production path — not a nicety.
    it.each(["false", "FALSE", " false ", "n", "N", "no", "No"])("suppresses on %o", (v) => {
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: v })).toBe(true);
    });

    it.each(["true", "TRUE", "y", "Y", "yes", "", "0", "1"])("does not suppress on %o", (v) => {
      expect(isListingDisplayOptedOut({ InternetEntireListingDisplayYN: v })).toBe(false);
    });
  });

  describe("the two switches stay independent", () => {
    it("reads the address switch separately", () => {
      const addressOnly = { InternetAddressDisplayYN: false, InternetEntireListingDisplayYN: true };
      expect(isAddressDisplayOptedOut(addressOnly)).toBe(true);
      expect(isListingDisplayOptedOut(addressOnly)).toBe(false);
    });

    it("combines them only where a surface needs either", () => {
      expect(isAnyInternetDisplayOptedOut({ InternetAddressDisplayYN: false })).toBe(true);
      expect(isAnyInternetDisplayOptedOut({ InternetEntireListingDisplayYN: false })).toBe(true);
      expect(isAnyInternetDisplayOptedOut({})).toBe(false);
    });
  });

  describe("isOptedOutValue on a pre-extracted column", () => {
    it("reads the string PostgREST returns", () => {
      expect(isOptedOutValue("false")).toBe(true);
      expect(isOptedOutValue("true")).toBe(false);
    });

    it("reads the boolean the live feed sends", () => {
      expect(isOptedOutValue(false)).toBe(true);
      expect(isOptedOutValue(true)).toBe(false);
    });

    it("treats an unselected column as NOT opted out", () => {
      expect(isOptedOutValue(undefined)).toBe(false);
      expect(isOptedOutValue(null)).toBe(false);
    });
  });

  describe("the 188 Maplehurst payloads that started this", () => {
    it("suppresses C13661766, where the agent set the switch", () => {
      expect(
        isListingDisplayOptedOut({
          ListingKey: "C13661766",
          InternetEntireListingDisplayYN: false,
          InternetAddressDisplayYN: false,
        })
      ).toBe(true);
    });

    it("leaves C13010562 alone, where the agent did not", () => {
      expect(
        isListingDisplayOptedOut({
          ListingKey: "C13010562",
          InternetEntireListingDisplayYN: true,
          InternetAddressDisplayYN: true,
        })
      ).toBe(false);
    });
  });
});
