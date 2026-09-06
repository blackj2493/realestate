import { describe, it, expect } from "vitest";
import { renderDailyMetricsEmail } from "./dailyMetricsEmail";
import type { DailyMetricsInput } from "@/lib/ops/dailyMetrics";

const m = (o: Partial<DailyMetricsInput> = {}): DailyMetricsInput => ({
  day: "2026-09-05",
  today: { visitors: 36, signups: 10, returning: 2, unsubscribes: 0, assetsCreated: 8, applications: 2, vowReads: 190 },
  prior7: { visitors: 45, signups: 5.7, returning: 3, unsubscribes: 0.4, assetsCreated: 6, applications: 0.5, vowReads: 140 },
  activation: [{ kind: "accept_vow_terms", count: 10 }],
  email: { digestSent: 124, digestFailed: 0, digestSuppressed: 13, sendFailures: 0 },
  leads: [],
  totals: { users: 391, optedOut: 26, withAnyAsset: 160 },
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
    expect(r.subject).toBe("2026-09-05 · 10 signups · 36 visitors");
  });

  it("computes the conversion rate the operator actually cares about", () => {
    expect(renderDailyMetricsEmail(m()).text).toContain("27.8%"); // 10 of 36
  });

  it("says so plainly when nothing needs attention", () => {
    const r = renderDailyMetricsEmail(m());
    expect(r.text).toContain("Nothing needs you this morning.");
  });

  it("lists applications with who to contact", () => {
    const r = renderDailyMetricsEmail(
      m({ leads: [{ createdAt: "2026-09-05T18:30:00Z", kind: "investor", who: "A Person · a@example.com", detail: "Ottawa" }] })
    );
    expect(r.html).toContain("a@example.com");
    expect(r.subject).toContain("1 lead");
  });

  it("escapes lead-supplied text rather than interpolating it into the markup", () => {
    // Names and emails come from a public form. They are the only untrusted strings here.
    const r = renderDailyMetricsEmail(
      m({ leads: [{ createdAt: "2026-09-05T18:30:00Z", kind: "x", who: '<script>alert(1)</script>' }] })
    );
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
    const zero = { visitors: 0, signups: 0, returning: 0, unsubscribes: 0, assetsCreated: 0, applications: 0, vowReads: 0 };
    const r = renderDailyMetricsEmail(
      m({ today: zero, prior7: zero, activation: [], totals: { users: 0, optedOut: 0, withAnyAsset: 0 } })
    );
    expect(r.text).not.toContain("NaN");
    expect(r.html).not.toContain("NaN");
    expect(r.text).toContain("No activation events recorded.".slice(0, 10));
  });
});
