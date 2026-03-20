import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva(
  "inline-flex min-h-11 w-full flex-wrap items-center gap-2 rounded-[calc(var(--radius-sm))] border p-1",
  {
    variants: {
      variant: {
        default:
          "border-[hsl(var(--border)/0.1)] bg-[linear-gradient(180deg,hsl(var(--surface-muted))_0%,hsl(var(--surface-panel))_100%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.62)]",
        quiet: "border-transparent bg-transparent p-0 shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const tabsTriggerVariants = cva(
  "type-nav inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius-sm)-2px)] border border-transparent px-3 py-2 text-[11px] text-center ring-offset-background motion-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "flex-1 text-foreground/58 data-[state=active]:border-[hsl(var(--border)/0.12)] data-[state=active]:bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_12px_26px_-22px_hsl(var(--surface-shadow)/0.42)] hover:text-foreground",
        quiet:
          "rounded-none border-b-2 border-transparent px-0 py-1 text-foreground/58 data-[state=active]:border-[hsl(var(--brand-accent))] data-[state=active]:bg-transparent data-[state=active]:text-foreground hover:text-foreground",
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
