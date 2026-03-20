import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const safeValue = Math.max(0, Math.min(100, value ?? 0));

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full border border-[hsl(var(--border)/0.12)] bg-[linear-gradient(180deg,hsl(var(--surface-muted)/0.8),hsl(var(--surface-panel)/0.82))] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.72)]",
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-y-[3px] left-3 right-3 rounded-full bg-[linear-gradient(90deg,hsl(var(--surface-line)/0.2),transparent)]" />
      <ProgressPrimitive.Indicator
        className="relative h-full w-full flex-1 rounded-full bg-[linear-gradient(90deg,hsl(var(--brand-accent)),hsl(var(--brand-accent-soft)))] shadow-[0_12px_24px_-14px_hsl(var(--brand-accent)/0.52)] transition-transform duration-500 ease-out after:absolute after:inset-y-[1px] after:left-[2px] after:right-[34%] after:rounded-full after:bg-[linear-gradient(180deg,hsl(0_0%_100%/0.45),transparent)]"
        style={{ transform: `translateX(-${100 - safeValue}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
