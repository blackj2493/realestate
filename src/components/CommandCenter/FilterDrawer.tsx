/**
 * FilterDrawer — the desktop (md+) home of FilterPanel: a right-side drawer.
 *
 * The bar keeps price, beds, baths and type inline; the "Filters" button opens this drawer,
 * which holds the same panel as the phone sheet (lens tools, picks with live counts, the
 * Home details / In the description / Investor signals pages), plus a "Find a filter" box
 * that pulls any field from any page onto one list. One panel for both surfaces means the
 * controls, counts and query can never drift between them.
 */

"use client";

import React from "react";
import FilterPanel, { type FilterPanelProps } from "./filterPanel/FilterPanel";

export default function FilterDrawer(props: Omit<FilterPanelProps, "surface" | "dragHandleProps">) {
  return (
    <div className="fixed inset-0 z-[60] hidden md:block" role="dialog" aria-modal="true" aria-label="All filters">
      <button
        type="button"
        aria-label="Close filters"
        onClick={props.onClose}
        className="absolute inset-0 bg-background/70"
      />
      <div className="absolute right-0 top-0 h-full w-[440px] max-w-full border-l border-border shadow-2xl">
        <FilterPanel {...props} surface="drawer" />
      </div>
    </div>
  );
}
