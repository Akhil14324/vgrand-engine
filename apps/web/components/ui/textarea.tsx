"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useSketch } from "@/lib/sketch";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const bare = (className ?? "").split(" ").includes("border-0");
    const sketchRef = useSketch<HTMLTextAreaElement>(bare ? null : focused ? "active" : "input", ref);
    return (
      <textarea
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
          "flex min-h-[60px] w-full rounded-md px-3 py-2 text-base text-foreground placeholder:text-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
