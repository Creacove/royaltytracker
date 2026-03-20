import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "flex w-full rounded-[calc(var(--radius-sm))] border px-3 py-2 text-sm ring-offset-background motion-standard file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-10 border-[hsl(var(--border)/0.14)] bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.62)]",
        evidence:
          "h-10 border-[hsl(var(--border)/0.2)] bg-[linear-gradient(180deg,hsl(var(--surface-panel))_0%,hsl(33_21%_93%)_100%)] font-mono text-[13px] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.56)]",
        quiet:
          "h-10 border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.45)] text-foreground shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface InputProps
  extends React.ComponentProps<"input">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return <input type={type} className={cn(inputVariants({ variant, className }))} ref={ref} {...props} />;
  },
);
Input.displayName = "Input";

export { Input, inputVariants };
