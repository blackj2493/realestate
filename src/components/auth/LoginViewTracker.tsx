"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/posthog";

/**
 * Fires `auth_login_viewed` once per /login render, tagged with the gate that sent the
 * visitor. Only the gate NAME is sent — never the address or listing key (posthog.ts
 * compliance note).
 */
export default function LoginViewTracker({ gate }: { gate: string }) {
  useEffect(() => {
    track("auth_login_viewed", { gate });
  }, [gate]);
  return null;
}
