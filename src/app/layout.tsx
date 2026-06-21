import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import WatchlistInit from "@/components/watchlist/WatchlistInit";
import DiscoveryRoot from "@/components/discovery/DiscoveryRoot";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Default title/description for the homepage + any page that doesn't set its own
  // (the hubs all override with absolute titles, so no template is used here).
  title: "PureProperty | Ontario Real Estate Listings & Market Intelligence",
  description:
    "Browse every active Ontario MLS® listing on PureProperty — with cap-rate, school, walkability, and development intelligence the consumer portals don't show. Built for serious buyers and investors.",
  openGraph: {
    type: "website",
    siteName: "PureProperty",
    url: SITE_URL,
    title: "PureProperty | Ontario Real Estate Listings & Market Intelligence",
    description:
      "Every active Ontario MLS® listing, decoded — cap rate, schools, walkability, and development potential in one place.",
    images: [
      ogImageUrl({
        eyebrow: "Ontario Real Estate",
        title: "Every listing, decoded.",
        subtitle: "Cap-rate, school, walkability & development intelligence the portals don't show.",
      }),
    ],
  },
  twitter: { card: "summary_large_image", title: "PureProperty", description: "Ontario real estate, decoded for serious buyers and investors." },
};

// Sitewide brand entity (Organization) + site (WebSite) structured data. Renders on every
// page; Google de-dupes. The WebSite SearchAction can power a sitelinks search box, and
// Organization establishes the brand entity (name/logo/url) for the Knowledge Graph.
const ORG_AND_SITE_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "PureProperty",
      url: SITE_URL,
      logo: `${SITE_URL}/logo.svg`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "PureProperty",
      publisher: { "@id": `${SITE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/properties?search={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

// Mobile viewport: device-width + viewport-fit=cover so safe-area-inset env()
// vars resolve on notched phones; dark theme-color so the browser chrome matches
// the app instead of flashing white. Pinch-zoom left enabled on purpose (a11y).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A1828",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className={`${inter.className} min-h-app bg-background text-foreground`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_AND_SITE_JSONLD) }}
        />
        <WatchlistInit />
        {children}
        <DiscoveryRoot />
        <Toaster />
      </body>
    </html>
  );
}
