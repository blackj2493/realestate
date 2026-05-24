/**
 * MapLayersPanel — floating left panel over the map. Houses the data-layer
 * toggles (Commute, School) that previously lived in the top bar. Each row opens
 * its own config popover to the right.
 */

"use client";

import React from "react";
import { Layers } from "lucide-react";
import CommuteFilter from "./CommuteFilter";
import SchoolFilter from "./SchoolFilter";

export default function MapLayersPanel() {
  return (
    <div className="w-80 border border-slate-800 bg-slate-900/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <Layers className="h-4 w-4 text-cyan-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Data Layers
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <CommuteFilter />
        <SchoolFilter />
      </div>
    </div>
  );
}
