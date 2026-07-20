import type { ReactNode } from "react";
import AppHeader from "@/components/layout/AppHeader";

/**
 * Public /data hub layout — renders the marketing header (the (app) route group's
 * app header does not apply here). /embed/* lives outside this tree so widgets stay
 * chrome-free for iframing.
 */
export default function DataLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader variant="marketing" />
      {children}
    </>
  );
}
