import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva(
  "inline-flex min-h-11 flex-wrap items-center gap-1.5 rounded-[calc(var(--radius-sm)+6px)] border p-1.5",
  {
    variants: {
      variant: {
        default:
          "w-full border-[hsl(var(--border)/0.1)] bg-[linear-gradient(180deg,hsl(var(--surface-muted)/0.96)_0%,hsl(var(--surface-panel)/0.98)_100%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.68),0_18px_34px_-30px_hsl(var(--surface-shadow)/0.2)]",
        quiet:
          "w-auto border-[hsl(var(--border)/0.1)] bg-[linear-gradient(180deg,hsl(var(--surface-panel)/0.94)_0%,hsl(var(--surface-muted)/0.88)_100%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.66),0_16px_30px_-26px_hsl(var(--surface-shadow)/0.18)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const tabsTriggerVariants = cva(
  "type-nav relative inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius-sm)+2px)] border px-3.5 py-2 text-[11px] text-center ring-offset-background motion-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "flex-1 border-transparent text-foreground/58 hover:border-[hsl(var(--border)/0.1)] hover:bg-[hsl(var(--surface-elevated)/0.88)] hover:text-foreground data-[state=active]:border-[hsl(var(--brand-accent)/0.18)] data-[state=active]:bg-[linear-gradient(180deg,hsl(var(--brand-accent-ghost)/0.82)_0%,hsl(var(--surface-elevated))_100%)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_16px_30px_-24px_hsl(var(--brand-accent)/0.28)] data-[state=active]:before:absolute data-[state=active]:before:inset-x-3 data-[state=active]:before:top-1 data-[state=active]:before:h-px data-[state=active]:before:rounded-full data-[state=active]:before:bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.68),transparent)]",
        quiet:
          "flex-none border-transparent bg-transparent text-foreground/58 hover:border-[hsl(var(--border)/0.1)] hover:bg-[hsl(var(--surface-elevated)/0.88)] hover:text-foreground data-[state=active]:border-[hsl(var(--brand-accent)/0.18)] data-[state=active]:bg-[linear-gradient(180deg,hsl(var(--brand-accent-ghost)/0.94)_0%,hsl(var(--surface-elevated))_100%)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_14px_28px_-24px_hsl(var(--brand-accent)/0.3)] data-[state=active]:before:absolute data-[state=active]:before:inset-x-3 data-[state=active]:before:top-1 data-[state=active]:before:h-px data-[state=active]:before:rounded-full data-[state=active]:before:bg-[linear-gradient(90deg,hsl(var(--brand-accent)/0.7),transparent)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>
>(({ className, variant, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn(tabsListVariants({ variant }), className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsVariantContext = React.createContext<VariantProps<typeof tabsTriggerVariants>["variant"]>("default");

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & VariantProps<typeof tabsTriggerVariants>
>(({ className, variant, ...props }, ref) => {
  const inheritedVariant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ variant: variant ?? inheritedVariant }), className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

function TabsScopeProvider({
  variant = "default",
  children,
}: {
  variant?: VariantProps<typeof tabsTriggerVariants>["variant"];
  children: React.ReactNode;
}) {
  return <TabsVariantContext.Provider value={variant}>{children}</TabsVariantContext.Provider>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsScopeProvider };
