import { Lock } from "lucide-react";

export default function LockedCell() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" title="Sign in to view">
      <Lock className="h-3.5 w-3.5 text-cyan-400/70" />
      <span aria-hidden="true" className="select-none blur-[2px]">•••</span>
    </span>
  );
}
