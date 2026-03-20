import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius-sm))] border text-[11px] font-ui font-semibold uppercase tracking-[0.12em] ring-offset-background motion-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-foreground bg-foreground text-primary-foreground shadow-[0_16px_28px_-18px_hsl(var(--foreground)/0.8)] hover:-translate-y-px hover:border-[hsl(var(--brand-accent))] hover:bg-[hsl(var(--brand-accent))]",
        destructive:
          "border-[hsl(var(--tone-critical))] bg-[hsl(var(--tone-critical))] text-destructive-foreground shadow-[0_16px_28px_-18px_hsl(var(--tone-critical)/0.55)] hover:-translate-y-px hover:bg-[hsl(var(--tone-critical)/0.92)]",
        outline:
          "border-[hsl(var(--border)/0.14)] bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.62)] hover:-translate-y-px hover:border-[hsl(var(--brand-accent)/0.25)] hover:bg-[hsl(var(--brand-accent-ghost)/0.4)]",
        secondary:
          "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-muted))] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.58)] hover:-translate-y-px hover:bg-[hsl(var(--surface-elevated))]",
        ghost:
          "border-transparent bg-transparent text-foreground/68 shadow-none hover:border-[hsl(var(--border)/0.12)] hover:bg-[hsl(var(--surface-elevated)/0.92)] hover:text-foreground",
        quiet:
          "border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.55)] text-foreground/78 shadow-none hover:border-[hsl(var(--brand-accent)/0.18)] hover:bg-[hsl(var(--surface-elevated)/0.96)] hover:text-foreground",
        link: "h-auto border-transparent px-0 py-0 text-[hsl(var(--brand-accent))] shadow-none hover:text-[hsl(var(--foreground))] hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
