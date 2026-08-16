import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";

/**
 * Public /data hub layout — renders the marketing header (the (app) route group's
 * app header does not apply here). /embed/* lives outside this tree so widgets stay
 * chrome-free for iframing.
 *
 * The footer matters most on exactly these pages: they are the ones the outreach
 * campaign sends people to, and cross-linking the trackers to each other is what turns
 * a set of orphans into a section.
 */
export default function DataLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader variant="marketing" />
      {children}
      <SiteFooter />
    </>
  );
}
