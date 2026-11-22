import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useSketch, type SketchKind } from "@/lib/sketch";

// Filled variants get a hand-drawn outline from useSketch (see lib/sketch.ts),
// so they carry no CSS border/background of their own. ghost/link stay flat.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold tracking-[-0.005em] transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-primary-foreground",
        destructive: "text-destructive-foreground",
        outline: "text-foreground",
        secondary: "text-foreground",
        ghost: "font-medium hover:translate-y-0 hover:bg-accent hover:text-accent-foreground",
        link: "font-medium text-lavd underline underline-offset-4 hover:translate-y-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const SKETCH: Record<string, SketchKind | null> = {
  default: "button",
  destructive: "danger",
  outline: "ghost",
  secondary: "ghost",
  ghost: null,
  link: null,
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const kind = SKETCH[variant ?? "default"] ?? null;
    const sketchRef = useSketch<HTMLButtonElement>(kind, ref);
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), kind && "sk", className)}
        ref={sketchRef}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
