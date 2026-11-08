import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";

/** Public /house-not-selling pages: the marketing header and the site footer, like /data. */
export default function NotSellingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader variant="marketing" />
      {children}
      <SiteFooter />
    </>
  );
}
