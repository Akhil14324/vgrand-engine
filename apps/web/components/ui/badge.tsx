"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useSketch, type SketchKind } from "@/lib/sketch";

// Chips are small handwritten tags with a pen-drawn outline.
const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2.5 py-0.5 font-hand text-[15px] font-semibold leading-tight transition-colors",
  {
    variants: {
      variant: {
        default: "text-lavd",
        secondary: "bg-secondary text-secondary-foreground rounded-full",
        outline: "text-foreground",
        destructive: "text-destructive",
        muted: "bg-muted text-muted-foreground rounded-full",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const SKETCH: Record<string, SketchKind | null> = {
  default: "chip",
  outline: "ghost",
  destructive: "chip",
  secondary: null,
  muted: null,
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  const kind = SKETCH[variant ?? "default"] ?? null;
  const ref = useSketch<HTMLDivElement>(kind);
  return (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant }), kind && "sk !border-[1px]", className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
