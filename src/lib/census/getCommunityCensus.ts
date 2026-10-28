import { getServiceRoleClient } from "@/lib/supabase/client";
import type { AreaFacts } from "./areaFacts";

/**
 * Census facts for a neighbourhood hub (migration 161), by its raw TRREB City values and
 * CityRegion value(s). When a slug matches more than one row, the row with the most DAs
 * wins. null on no row or any failure: the section is optional, the listings are not.
 */
export async function getCommunityCensus(cities: string[], regions: string[]): Promise<AreaFacts | null> {
  if (cities.length === 0 || regions.length === 0) return null;
  try {
    const { data, error } = await getServiceRoleClient()
      .from("census_community_area")
      .select("facts")
      .in("city", cities)
      .in("city_region", regions)
      .order("das", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const facts = data?.facts as AreaFacts | undefined;
    return facts && facts.v === 1 ? facts : null;
  } catch (err) {
    console.error("[getCommunityCensus] failed:", err);
    return null;
  }
}
