import { describe, it, expect } from "vitest";
import { touchFromLoad, mergeTouches, cleanTouches, type Touch } from "./touch";
import { attributionRow } from "./signupAttribution";

const NOW = new Date("2026-09-28T12:00:00Z");
const SITE = "https://www.pureproperty.ca";

const direct = (path = "/"): Touch => ({
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  referrer_host: null,
  landing_path: path,
  at: NOW.toISOString(),
});

describe("touchFromLoad", () => {
  it("reads the UTM tags of a tagged Reddit link, even with no referrer (the iOS app)", () => {
    const t = touchFromLoad(`${SITE}/data/rents?utm_source=reddit&utm_campaign=mississauga-oct`, "", NOW);
    expect(t).toMatchObject({
      utm_source: "reddit",
      utm_campaign: "mississauga-oct",
      referrer_host: null,
      landing_path: "/data/rents?utm_source=reddit&utm_campaign=mississauga-oct",
    });
  });

  it("keeps only the referrer HOST, without www", () => {
    const t = touchFromLoad(`${SITE}/`, "https://www.reddit.com/r/mississauga/comments/abc?x=secret", NOW);
    expect(t?.referrer_host).toBe("reddit.com");
    expect(JSON.stringify(t)).not.toContain("secret");
  });

  it("is not an arrival for an internal or tagless, referrer-less load", () => {
    expect(touchFromLoad(`${SITE}/properties`, `${SITE}/`, NOW)).toBeNull();
    expect(touchFromLoad(`${SITE}/properties`, "https://pureproperty.ca/", NOW)).toBeNull();
    expect(touchFromLoad(`${SITE}/properties`, "", NOW)).toBeNull();
  });

  it("ignores the sign-in round trip, so a Google signup is not credited to Google", () => {
    expect(touchFromLoad(`${SITE}/welcome`, "https://accounts.google.com/", NOW)).toBeNull();
    expect(touchFromLoad(`${SITE}/auth/callback`, "https://abc.supabase.co/auth/v1", NOW)).toBeNull();
  });

  it("clips long values", () => {
    const t = touchFromLoad(`${SITE}/?utm_source=${"x".repeat(500)}`, "", NOW);
    expect(t?.utm_source).toHaveLength(200);
  });
});

describe("mergeTouches", () => {
  const reddit = touchFromLoad(`${SITE}/?utm_source=reddit`, "", NOW)!;
  const google = touchFromLoad(`${SITE}/`, "https://www.google.com/", NOW)!;

  it("sets first once and never overwrites it", () => {
    const a = mergeTouches({ first: null, last: null }, google, direct());
    const b = mergeTouches(a, reddit, direct());
    expect(b.first?.referrer_host).toBe("google.com");
    expect(b.last?.utm_source).toBe("reddit");
  });

  it("records a direct first visit, so a later Reddit visit is not the introduction", () => {
    const a = mergeTouches({ first: null, last: null }, null, direct("/"));
    const b = mergeTouches(a, reddit, direct());
    expect(b.first?.utm_source).toBeNull();
    expect(b.last?.utm_source).toBe("reddit");
  });

  it("keeps the last external arrival across internal loads", () => {
    const a = mergeTouches({ first: null, last: null }, reddit, direct());
    expect(mergeTouches(a, null, direct()).last?.utm_source).toBe("reddit");
  });
});

describe("cleanTouches", () => {
  it("drops junk and touches without a valid timestamp", () => {
    expect(cleanTouches("nope")).toEqual({ first: null, last: null });
    expect(cleanTouches({ first: { utm_source: "reddit" } }).first).toBeNull();
    expect(cleanTouches({ first: { utm_source: 5, at: NOW.toISOString() } }).first?.utm_source).toBeNull();
  });
});

describe("attributionRow", () => {
  it("flattens both touches into columns", () => {
    const reddit = touchFromLoad(`${SITE}/?utm_source=reddit&utm_campaign=c1`, "", NOW)!;
    const row = attributionRow("u1", { first: direct("/"), last: reddit });
    expect(row).toMatchObject({
      user_id: "u1",
      first_landing_path: "/",
      first_utm_source: null,
      last_utm_source: "reddit",
      last_utm_campaign: "c1",
      last_at: NOW.toISOString(),
    });
  });

  it("returns null when there is nothing to save", () => {
    expect(attributionRow("u1", undefined)).toBeNull();
    expect(attributionRow("u1", { first: null, last: null })).toBeNull();
  });
});
