import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";

/** Public /home-value pages: the marketing header and the site footer, like /data. */
export default function HomeValueLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader variant="marketing" />
      {children}
      <SiteFooter />
    </>
  );
}
