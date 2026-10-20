"use client";

/**
 * Which programs a school publishes an attendance boundary for, read in the browser.
 *
 * The server answers it from catchmentPrograms.ts through GET /api/schools/[id]. A saved
 * school area is scoped by it everywhere — the nightly brief, the bubble stats, the
 * dashboard section and the terminal — so all of them show the same homes.
 *
 * Best-effort, like the server lookup: any failure resolves to [] and the caller keeps the
 * 2.5 km radius. One request per school per page load.
 */

import { useEffect, useState } from "react";
import type { SchoolProgram } from "@/lib/stores/commandCenterStore";

const cache = new Map<string, Promise<SchoolProgram[]>>();

export function fetchSchoolPrograms(schoolId: string): Promise<SchoolProgram[]> {
  let p = cache.get(schoolId);
  if (!p) {
    p = fetch(`/api/schools/${encodeURIComponent(schoolId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { school?: { programs?: SchoolProgram[] } } | null) =>
        Array.isArray(d?.school?.programs) ? d.school.programs : []
      )
      .catch(() => []);
    cache.set(schoolId, p);
  }
  return p;
}

/** undefined while the lookup runs; null id (not a school area) resolves to [] at once. */
export function useSchoolPrograms(schoolId: string | null): SchoolProgram[] | undefined {
  const [state, setState] = useState<{ id: string; programs: SchoolProgram[] } | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    let alive = true;
    fetchSchoolPrograms(schoolId).then((programs) => {
      if (alive) setState({ id: schoolId, programs });
    });
    return () => {
      alive = false;
    };
  }, [schoolId]);

  if (!schoolId) return [];
  return state?.id === schoolId ? state.programs : undefined;
}
