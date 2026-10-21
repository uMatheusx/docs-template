import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        brand: "border-brand/25 bg-brand-soft text-brand-ink",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-muted-foreground",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
