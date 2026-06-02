import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status badge / pill (design-system spec §5.3). Mono, uppercase, tracked.
 * Variants map to the pp-* semantic tokens; `active` uses the cyan accent
 * (reserved for live/active state). On tinted bg with colored text — never
 * white-on-color.
 */
const badgeVariants = cva(
  "inline-flex items-center font-mono text-pp-xs uppercase tracking-wider px-2 py-0.5 rounded-pp-sm border whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-pp-bg-elevated text-pp-secondary border-pp-border-subtle",
        active: "bg-pp-accent-bg text-pp-accent border-pp-accent",
        success: "bg-pp-success-bg text-pp-success border-pp-success/30",
        danger: "bg-pp-danger-bg text-pp-danger border-pp-danger/30",
        warning: "bg-pp-warning-bg text-pp-warning border-pp-warning/30",
        info: "bg-pp-info-bg text-pp-info border-pp-info/30",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
