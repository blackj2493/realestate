/**
 * The publisher of every public data page, for JSON-LD. The "@id" points at the sitewide
 * Organization node in src/app/layout.tsx, so search engines read each Dataset's creator as
 * the same entity as the site (one PureProperty, not one per page).
 */
const SITE_URL = "https://www.pureproperty.ca";

export const DATA_PUBLISHER = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "PureProperty",
  url: SITE_URL,
} as const;

/** How the data pages are built: sources, definitions, limits, updates, corrections. */
export const METHODOLOGY_PATH = "/data/methodology";
