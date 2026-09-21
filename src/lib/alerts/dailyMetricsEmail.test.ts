import { describe, it, expect } from "vitest";
import { renderDailyMetricsEmail } from "./dailyMetricsEmail";
import type { DailyCounts, DailyMetricsInput, PersonRow } from "@/lib/ops/dailyMetrics";

const counts = (o: Partial<DailyCounts> = {}): DailyCounts => ({
  listingViewers: 36,
  signups: 10,
  returning: 21,
  returningLogins: 2,
  unsubscribes: 0,
  assetsSaved: 8,
  assetsAtSignup: 10,
  abandonedSignups: 0,
  vowReads: 190,
  vowReaders: 24,
  ...o,
});

const m = (o: Partial<DailyMetricsInput> = {}): DailyMetricsInput => ({
  day: "2026-09-05",
  today: counts(),
  prior7: counts({ listingViewers: 45, signups: 5.7, returning: 19, unsubscribes: 0.4, assetsSaved: 6, vowReads: 140 }),
  activation: [{ kind: "accept_vow_terms", count: 10 }],
  email: { digestSent: 124, digestFailed: 0, digestSuppressed: 13, sendFailures: 0 },
  signups: [],
  abandoned: [],
  totals: { users: 391, optedOut: 26, withAnyAsset: 160, abandonedAllTime: 9 },
  ...o,
});

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  createdAt: "2026-09-05T18:30:00Z",
  who: "A Person · a@example.com",
  ...o,
});

describe("renderDailyMetricsEmail", () => {
  it("carries the headline numbers in both html and text", () => {
    const r = renderDailyMetricsEmail(m());
    for (const part of [r.html, r.text]) {
      expect(part).toContain("36");
      expect(part).toContain("10");
      expect(part).toContain("124");
    }
    expect(r.subject).toBe("2026-09-05 · 10 signups · 36 viewers");
  });

  it("names the listing-viewer metric after what the table can actually see", () => {
    // The whole point of the rename. "Visitors" invited the reader to treat a
    // listing-detail-page counter as site traffic.
    const r = renderDailyMetricsEmail(m());
    expect(r.html).toContain("Listing viewers");
    expect(r.html).not.toMatch(/>\s*Visitors\s*</);
    expect(r.text).toContain("listing detail pages only");
  });

  it("drops the row that subtracted accounts from anonymous browser ids", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.html).not.toContain("did not sign up");
    expect(r.text).not.toContain("did not sign up");
  });

  it("marks the signup ratio as a proxy rather than a funnel rate", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.text).toContain("27.8%"); // 10 of 36
    expect(r.html).toContain("rough proxy");
  });

  it("shows the re-login count beside returning, so the weak source stays visible", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.html).toContain("2 of them re-logged in");
    expect(r.text).toContain("2 via re-login");
  });

  it("reports signup-created areas apart from real saves", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.html).toContain("Areas created by signup");
    expect(r.html).toContain("not engagement");
    expect(r.text).toContain("Areas+listings saved 8 (10 more created by signup)");
  });

  it("gives VOW reads their reader count", () => {
    expect(renderDailyMetricsEmail(m()).text).toContain("VOW reads 190 by 24 users");
  });

  it("says so plainly when nothing needs attention", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.text).toContain("Nothing needs you this morning.");
  });

  it("lists new signups without calling them work", () => {
    const r = renderDailyMetricsEmail(m({ signups: [person()] }));
    expect(r.html).toContain("a@example.com");
    expect(r.html).toContain("New signups");
    expect(r.text).toContain("Nothing needs you this morning.");
    expect(r.subject).not.toContain("unfinished");
  });

  it("lists unfinished signups with who to contact", () => {
    const r = renderDailyMetricsEmail(
      m({ abandoned: [person({ detail: "Ottawa" })], today: counts({ abandonedSignups: 1 }) })
    );
    expect(r.html).toContain("a@example.com");
    expect(r.html).toContain("Ottawa");
    expect(r.subject).toContain("1 unfinished");
  });

  it("says the happy thing when everyone finished", () => {
    expect(renderDailyMetricsEmail(m()).html).toContain("Everyone who started signup finished it.");
  });

  it("caps a long signup list instead of mailing a hundred rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => person({ who: `P${i} · p${i}@example.com` }));
    const r = renderDailyMetricsEmail(m({ signups: many }));
    expect(r.html).toContain("+ 5 more");
    expect(r.html).not.toContain("p28@example.com");
    expect(r.text).toContain("+ 5 more");
  });

  it("escapes person-supplied text rather than interpolating it into the markup", () => {
    // Names and emails come from a public form. They are the only untrusted strings here.
    const r = renderDailyMetricsEmail(m({ abandoned: [person({ who: "<script>alert(1)</script>" })] }));
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("is an internal report: no unsubscribe link and no MLS notice", () => {
    const r = renderDailyMetricsEmail(m());
    // "Unsubscribes" is a legitimate metric ROW label here, so assert on the footer LINK.
    expect(r.html).not.toMatch(/>\s*Unsubscribe\s*<\/a>/);
    expect(r.html).not.toContain("Manage alerts");
    expect(r.html).not.toContain("PROPTX");
  });

  it("renders a day with no activity at all without dividing by zero", () => {
    const zero = counts({
      listingViewers: 0,
      signups: 0,
      returning: 0,
      returningLogins: 0,
      assetsSaved: 0,
      assetsAtSignup: 0,
      vowReads: 0,
      vowReaders: 0,
    });
    const r = renderDailyMetricsEmail(
      m({
        today: zero,
        prior7: zero,
        activation: [],
        totals: { users: 0, optedOut: 0, withAnyAsset: 0, abandonedAllTime: 0 },
      })
    );
    expect(r.text).not.toContain("NaN");
    expect(r.html).not.toContain("NaN");
    expect(r.text).toContain("No activation events recorded.".slice(0, 10));
  });

  it("survives an unparseable timestamp on a listed person", () => {
    const r = renderDailyMetricsEmail(m({ signups: [person({ createdAt: "not-a-date" })] }));
    expect(r.html).not.toContain("Invalid Date");
  });
});
