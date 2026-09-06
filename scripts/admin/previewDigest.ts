/**
 * Render the nightly digest to a file so a human can look at it.
 *
 * The digest renderer is pure, so the only way to be wrong about what lands in an inbox is
 * to never open one. This builds the two shapes that matter for the filter work — a busy
 * unfiltered area (Toronto's real ~143/night) and a filtered one — and writes both the HTML
 * and the plain-text twin.
 *
 *   npx tsx scripts/admin/previewDigest.ts [outDir]
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { renderAlertsDigest, type DigestPayload } from "../../src/lib/alerts/digest";
import type { NewListingAlert } from "../../src/lib/alerts/bubbleDigest";

function listing(i: number, city: string): NewListingAlert {
  return {
    listing_key: `W${1000 + i}`,
    address: `${100 + i * 7} Sample Ave`,
    city,
    price: 749_000 + i * 31_000,
    beds: 2 + (i % 3),
    baths: 1 + (i % 2),
    brokerage: "SAMPLE REALTY BROKERAGE",
    thumb: null,
    entryMs: 1_700_000_000_000 - i * 1000,
  };
}

const payload: DigestPayload = {
  drops: [],
  statusChanges: [],
  bubbles: [
    {
      bubbleId: "b-toronto",
      bubbleName: "Toronto",
      total: 143, // the measured live rate
      listings: Array.from({ length: 6 }, (_, i) => listing(i, "Toronto")),
      highVolume: true,
      filterLabel: null, // alerts on everything → earns the nudge
    },
    {
      bubbleId: "b-barrhaven",
      bubbleName: "Barrhaven",
      total: 4,
      listings: Array.from({ length: 4 }, (_, i) => listing(10 + i, "Ottawa")),
      highVolume: false,
      filterLabel: "3+ bd · Detached",
    },
  ],
};

const outDir = process.argv[2] ?? ".";
const { subject, html, text } = renderAlertsDigest(payload, "https://example.test/unsub");
writeFileSync(join(outDir, "digest-preview.html"), html, "utf8");
writeFileSync(join(outDir, "digest-preview.txt"), `Subject: ${subject}\n\n${text}`, "utf8");
console.log("subject:", subject);
console.log("wrote digest-preview.html + digest-preview.txt to", outDir);
