import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/**
 * Public /data hub layout — renders the marketing header (the (app) route group's
 * app header does not apply here). /embed/* lives outside this tree so widgets stay
 * chrome-free for iframing.
 *
 * The footer matters most on exactly these pages: they are the ones the outreach
 * campaign sends people to, and cross-linking the trackers to each other is what turns
 * a set of orphans into a section.
 *
 * FEED AUTODISCOVERY is a raw <link>, not `alternates.types` in the metadata export,
 * on purpose. Metadata merges by whole top-level field: every tracker page sets its own
 * `alternates: { canonical }`, which would replace a layout-level `alternates` outright
 * and drop the feed link from exactly the pages a reader subscribes from. Rendering the
 * tag here puts it on every /data page unconditionally — Next hoists it into <head>.
 */
export default function DataLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link
        rel="alternate"
        type="application/rss+xml"
        title="PureProperty Data Desk — Ontario housing market"
        href={`${SITE_URL}/data/feeds/rss.xml`}
      />
      <AppHeader variant="marketing" />
      {children}
      <SiteFooter />
    </>
  );
}
