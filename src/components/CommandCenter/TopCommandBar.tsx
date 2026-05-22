/**
 * TopCommandBar — wordmark + persona selector + search + profile, with the
 * persona-driven filter bar below.
 */

"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommandCenterStore, type PersonaType } from "@/lib/stores/commandCenterStore";
import { PERSONA_LIST } from "@/lib/personas/personaConfig";
import PersonaFilterBar from "./PersonaFilterBar";
import CommuteFilter from "./CommuteFilter";

interface TopCommandBarProps {
  className?: string;
}

export default function TopCommandBar({ className }: TopCommandBarProps) {
  const { activePersona, setActivePersona, location, setLocation } = useCommandCenterStore();
  const [searchValue, setSearchValue] = React.useState(location);

  React.useEffect(() => setSearchValue(location), [location]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocation(searchValue);
  };

  return (
    <div className={cn("border-b border-slate-800 bg-slate-950", className)}>
      {/* Main bar */}
      <div className="flex items-center gap-4 px-4 py-2.5">
        {/* Wordmark */}
        <Link href="/" className="group flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 text-slate-300 transition-all group-hover:border-emerald-500/60 group-hover:text-emerald-400">
            <ChevronLeft className="h-4 w-4" strokeWidth={2.75} />
          </span>
          <span className="terminal-font text-lg font-bold tracking-tight">
            <span className="text-white">PURE</span>
            <span className="text-slate-400">PROPERTY</span>
            <span className="text-emerald-400">.ca</span>
          </span>
        </Link>

        <div className="h-6 w-px bg-slate-800" />

        {/* Persona selector */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Mode:</span>
          <Select value={activePersona} onValueChange={(v) => setActivePersona(v as PersonaType)}>
            <SelectTrigger className="h-8 w-[200px] border-slate-700 bg-slate-900 text-xs font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900">
              {PERSONA_LIST.map((p) => {
                const Icon = p.icon;
                return (
                  <SelectItem key={p.id} value={p.id} className={cn("text-xs", activePersona === p.id && "text-emerald-400")}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      {p.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <form onSubmit={submit} className="max-w-md flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search city, neighbourhood, or address..."
              className="h-9 border-slate-700 bg-slate-900 pl-10 pr-10 text-sm text-slate-200 placeholder:text-slate-500"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => {
                  setSearchValue("");
                  setLocation("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        {/* Commute-zone filter (global) */}
        <CommuteFilter />

        {/* Profile */}
        <Link
          href="/dashboard"
          className="terminal-font shrink-0 text-xs tracking-[0.2em] text-slate-400 transition-colors hover:text-emerald-400"
        >
          [ PROFILE ]
        </Link>
      </div>

      {/* Persona filter bar */}
      <PersonaFilterBar />
    </div>
  );
}
