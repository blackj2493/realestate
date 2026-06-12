import { NextResponse } from "next/server";

// Minimal liveness probe. Env/infra details were removed 2026-06-11 — they gave
// unauthenticated callers a free recon map (audit MEDIUM-22/LOW-28). If an ops
// dashboard ever needs config introspection, gate it behind a shared secret.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
