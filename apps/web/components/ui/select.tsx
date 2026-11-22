"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

/** Native <select> styled like Input - keeps mobile pickers and a11y for free. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const bare = (className ?? "").split(" ").includes("border-0");
    const sketchRef = useSketch<HTMLSelectElement>(bare ? null : focused ? "active" : "input", ref);
    return (
      <select
        ref={sketchRef}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn(
          !bare && "sk",
          "h-9 w-full rounded-md px-3 text-sm text-foreground transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";
