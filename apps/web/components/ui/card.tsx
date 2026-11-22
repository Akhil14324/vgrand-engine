"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "warn" draws the outline in the amber pen for caution panels. */
  tone?: "default" | "warn";
  /** Slight hand-placed tilt for repeated display cards. Never use on forms. */
  tilt?: 1 | 2 | 3;
}

/** Paper card with a hand-drawn pen outline. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = "default", tilt, ...props }, ref) => {
    const sketchRef = useSketch<HTMLDivElement>(tone === "warn" ? "warn" : "paper", ref);
    return (
      <div
        ref={sketchRef}
        className={cn(
          "sk sk-paper text-card-foreground transition-colors",
          tilt && `tilt-${tilt}`,
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />
);
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("font-display text-lg font-medium leading-tight tracking-[-0.01em]", className)} {...props} />
);
export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-xs text-muted-foreground", className)} {...props} />
);
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-4 pt-2", className)} {...props} />
);
