"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

/** Text field with a hand-drawn outline; the pen turns lavender on focus. */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const bare = (className ?? "").split(" ").includes("border-0");
    const sketchRef = useSketch<HTMLInputElement>(bare ? null : focused ? "active" : "input", ref);
    return (
      <input
        type={type}
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
          "flex h-9 w-full rounded-md px-3 py-1 text-base text-foreground transition-colors placeholder:text-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
