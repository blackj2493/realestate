"use client";

/**
 * Keeps one broken Filters page from taking the whole terminal down.
 *
 * Without it, any render error inside the panel bubbles to Next's root error page ("This
 * page couldn't load") and the reader loses the map, the list and the panel at once. With
 * it, only the page body is replaced: the reader can go back to the main page, reset the
 * filters, and the error text is on screen so a screenshot says what failed.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { LABEL } from "./primitives";

interface Props {
  children: React.ReactNode;
  onBack: () => void;
  onReset: () => void;
}

interface State {
  error: Error | null;
}

export default class PanelErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[FilterPanel] section failed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="space-y-3 border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="text-sm font-semibold text-foreground">This section couldn’t load.</p>
        <p className="break-words font-mono text-[11px] text-muted-foreground">{error.message || String(error)}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.props.onBack}
            className={cn(LABEL, "min-h-[40px] border border-border bg-card px-3 text-foreground hover:border-cyan-500/50")}
          >
            Back to filters
          </button>
          <button
            type="button"
            onClick={() => {
              this.props.onReset();
              this.setState({ error: null });
            }}
            className={cn(LABEL, "min-h-[40px] border border-border bg-card px-3 text-foreground hover:border-cyan-500/50")}
          >
            Reset filters
          </button>
        </div>
      </div>
    );
  }
}
