/**
 * SaveBubbleButton — contextual map overlay that lets the user persist the
 * currently-active custom area (draw / commute / school) as a Market Bubble.
 *
 * Only renders when at least one of the three sources is active. If multiple
 * are active simultaneously, priority order is draw → commute → school
 * (the most "manual" one wins, since that's the one the user just touched).
 */

"use client";

import React, { useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import type { BubbleAreaType } from "@/lib/bubbles/serialize";
import SaveBubbleDialog from "./SaveBubbleDialog";

export default function SaveBubbleButton() {
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const commutePolygon = useCommandCenterStore((s) => s.commute.polygon);
  const targetSchool = useCommandCenterStore((s) => s.school.targetSchool);

  const [open, setOpen] = useState(false);

  const areaType: BubbleAreaType | null =
    drawPolygon && drawPolygon.length >= 3
      ? "draw"
      : commuteEnabled && commutePolygon && commutePolygon.length >= 3
        ? "commute"
        : targetSchool
          ? "school"
          : null;

  if (!areaType) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-cyan-500/50 bg-slate-900/85 px-3 py-2 text-[11px] font-medium text-cyan-200 shadow-lg backdrop-blur transition-colors hover:bg-cyan-500/15"
      >
        <BookmarkPlus className="h-3.5 w-3.5" />
        Save as bubble
      </button>
      <SaveBubbleDialog open={open} onOpenChange={setOpen} areaType={areaType} />
    </>
  );
}
