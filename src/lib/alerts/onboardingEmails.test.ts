import { describe, expect, it } from "vitest";
import {
  renderDashboardEducationEmail,
  renderAddAreaEmail,
  renderSaveHomeEmail,
  renderFinishAccountEmail,
  type OnboardingAreaData,
} from "./onboardingEmails";

const exampleArea: OnboardingAreaData = {
  areaName: "Woodbridge",
  newCount: 247,
  activeCount: 1240,
  rows: [
    {
      listing_key: "N9000001",
      address: "12 Ashbury Blvd",
      city: "Vaughan",
      price: 899_000,
      thumb: "https://media.example.com/1.jpg",
      brokerage: "Royal LePage Maximum",
      boardTitle: "Highest Cap Rate",
      metricLabel: "CAP",
      metricValue: "8.4%",
    },
    {
      listing_key: "N9000002",
      address: "44 Clarence St",
      city: "Vaughan",
      price: 1_499_000,
      thumb: null, // missing photo → clean placeholder, still a row
      brokerage: null, // missing brokerage → "Brokerage unavailable"
      boardTitle: "Highest True DOM",
      metricLabel: "TRUE DOM",
      metricValue: "198d",
    },
  ],
};

describe("onboarding email renderers", () => {
  it("2A uses the approved subject with the area name and glosses specialized terms", () => {
    const { subject, html, text } = renderDashboardEducationEmail({
      areaName: "Vaughan",
      unsubscribeUrl: "https://www.pureproperty.ca/api/email/unsubscribe?e=x",
    });
    expect(subject).toBe("Get more out of your Vaughan dashboard");
    // Plain-language rule: Cap Rate / Capital Burn glossed inline (voice.md §5.1).
    expect(html).toMatch(/Cap Rate/);
    expect(html).toMatch(/yearly return if you rented it out/i);
    expect(html).toMatch(/what it costs to hold each month/i);
    expect(text).toContain("Open your dashboard");
  });

  it("2B keeps 'subject 1' and renders live rows with brokerage on EVERY row", () => {
    const { subject, html } = renderAddAreaEmail({
      example: exampleArea,
      unsubscribeUrl: "https://www.pureproperty.ca/api/email/unsubscribe?e=x",
    });
    expect(subject).toBe("Your own live dashboard for any neighbourhood");
    // Both stat tiles present.
    expect(html).toContain("New listings");
    expect(html).toContain("For sale now");
    // Board titles surface the breadth.
    expect(html).toContain("Highest Cap Rate");
    expect(html).toContain("Highest True DOM");
    // TRREB §6.3(c): a row missing ListOfficeName still shows the compliance fallback.
    expect(html).toContain("Royal LePage Maximum");
    expect(html).toContain("Brokerage unavailable");
    // The plain-language legend explains the specialized metrics once.
    expect(html).toMatch(/Cap Rate = the yearly return/i);
  });

  it("2B degrades gracefully with no example data (copy + CTA, no rows/MLS notice)", () => {
    const { html } = renderAddAreaEmail({ example: null });
    expect(html).toContain("Add your first area");
    // No listing rows → no mandatory MLS notice.
    expect(html).not.toContain("PROPTX MLS");
  });

  it("#3 uses the approved subject and shows the example as an example (not a real address)", () => {
    const { subject, html } = renderSaveHomeEmail({});
    expect(subject).toBe("Save the homes you like — we'll watch the price for you");
    expect(html).toContain("A home you're watching");
    expect(html).toMatch(/>Example</);
  });

  it("finish-account nudge points its CTA at the supplied url", () => {
    const { subject, html } = renderFinishAccountEmail({
      ctaUrl: "https://www.pureproperty.ca/login?email=a%40b.com",
    });
    expect(subject).toBe("You're almost in — one step left");
    expect(html).toContain("https://www.pureproperty.ca/login?email=a%40b.com");
  });
});
