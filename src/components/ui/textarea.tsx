import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof textareaVariants>;

const textareaVariants = cva(
  "flex min-h-[96px] w-full rounded-[calc(var(--radius-sm))] border px-3 py-2 text-sm ring-offset-background motion-standard placeholder:text-muted-foreground/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-[hsl(var(--border)/0.14)] bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.62)]",
        evidence:
          "border-[hsl(var(--border)/0.18)] bg-[linear-gradient(180deg,hsl(var(--surface-panel))_0%,hsl(33_21%_93%)_100%)] font-mono text-[13px] text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.56)]",
        quiet:
          "border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.48)] text-foreground shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, ...props }, ref) => {
    return <textarea className={cn(textareaVariants({ variant, className }))} ref={ref} {...props} />;
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
