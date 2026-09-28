"use client";

import { useEffect } from "react";
import { recordPageLoad } from "@/lib/analytics/touch";

/**
 * Records where this visit came from (see lib/analytics/touch). Mounted once in the root
 * layout, so the effect runs once per DOCUMENT — the only moment `document.referrer` and
 * the landing URL's UTM tags describe an arrival. Client-side navigations do not re-run it.
 * Independent of PostHog on purpose: attribution must not need an analytics key.
 */
export default function TouchRecorder() {
  useEffect(() => {
    recordPageLoad();
  }, []);
  return null;
}
