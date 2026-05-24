/**
 * MapDrawPanel — the "Draw Area" drawer. Lets a user lasso a custom search
 * polygon (the builder/wholesaler farm-area workflow HouseSigma lacks — they
 * only do rectangles/named neighborhoods). Opening the panel starts a draw;
 * closing it mid-draw cancels. A finished polygon persists as a geo filter until
 * cleared.
 */

"use client";

import React, { useEffect } from "react";
import { Undo2, Check, Trash2, PenTool } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

export default function MapDrawPanel() {
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPoints = useCommandCenterStore((s) => s.drawPoints);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const startDrawing = useCommandCenterStore((s) => s.startDrawing);
  const undoDrawPoint = useCommandCenterStore((s) => s.undoDrawPoint);
  const finishDrawing = useCommandCenterStore((s) => s.finishDrawing);
  const clearDraw = useCommandCenterStore((s) => s.clearDraw);
  const setActiveModule = useCommandCenterStore((s) => s.setActiveModule);

  // Begin a draw when the panel opens with nothing in progress; cancel an
  // unfinished draw if the panel closes (a committed polygon is left intact).
  useEffect(() => {
    if (!drawPolygon && !isDrawing) startDrawing();
    return () => {
      if (useCommandCenterStore.getState().isDrawing) clearDraw();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canFinish = drawPoints.length >= 3;

  if (drawPolygon) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs text-cyan-200">
          Custom area active — {drawPolygon.length} points. The map is filtered to this shape.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={startDrawing}
            className="flex flex-1 items-center justify-center gap-1.5 border border-slate-700 bg-slate-900 py-2 text-xs font-medium text-slate-200 hover:border-slate-600"
          >
            <PenTool className="h-3.5 w-3.5" /> Redraw
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraw();
              setActiveModule(null);
            }}
            className="flex flex-1 items-center justify-center gap-1.5 border border-rose-500/40 bg-rose-500/10 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-xs leading-relaxed text-slate-400">
        Click the map to drop points. Click the first point — or hit Finish — to close the
        shape and filter to it.
      </p>
      <div className="font-mono text-[11px] text-slate-300">
        Points placed: <span className="font-semibold text-cyan-300">{drawPoints.length}</span>
        {!canFinish && <span className="ml-1 text-slate-500">· need {3 - drawPoints.length} more</span>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={undoDrawPoint}
          disabled={drawPoints.length === 0}
          className="flex flex-1 items-center justify-center gap-1.5 border border-slate-700 bg-slate-900 py-2 text-xs font-medium text-slate-200 hover:border-slate-600 disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </button>
        <button
          type="button"
          onClick={finishDrawing}
          disabled={!canFinish}
          className="flex flex-1 items-center justify-center gap-1.5 border border-cyan-500/50 bg-cyan-500/15 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> Finish
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          clearDraw();
          setActiveModule(null);
        }}
        className="text-[11px] text-slate-500 hover:text-slate-300"
      >
        Cancel
      </button>
    </div>
  );
}
