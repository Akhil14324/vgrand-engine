"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const sketchRef = useSketch<HTMLDivElement>("ghost", ref);
  return (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={sketchRef}
      sideOffset={sideOffset}
      className={cn(
        "sk z-50 px-2.5 py-1.5 text-xs text-popover-foreground animate-fade-in",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
