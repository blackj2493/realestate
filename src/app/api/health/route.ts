import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "diagnostics active",
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL || "MISSING_OR_UNDEFINED",
      hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    ampre: {
      url: process.env.AMPRE_API_URL || "MISSING_OR_UNDEFINED",
      hasToken: !!process.env.RESO_BEARER_TOKEN
    },
    typesense: {
      hasAdminKey: !!process.env.TYPESENSE_ADMIN_API_KEY
    }
  });
}