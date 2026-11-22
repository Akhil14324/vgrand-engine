"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const sketchRef = useSketch<HTMLDivElement>("paper", ref);
  return (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={sketchRef}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "sk sk-paper z-50 w-72 p-2 text-popover-foreground outline-none animate-fade-in",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
