import * as React from "react";

import { cn } from "@/lib/utils";

type TableVariant = "default" | "evidence";
type TableDensity = "comfortable" | "compact";

type TableContextValue = {
  variant: TableVariant;
  density: TableDensity;
};

const TableContext = React.createContext<TableContextValue>({
  variant: "default",
  density: "comfortable",
});

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  variant?: TableVariant;
  density?: TableDensity;
  wrapperClassName?: string;
};

function useTableContext() {
  return React.useContext(TableContext);
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, variant = "default", density = "comfortable", wrapperClassName, ...props }, ref) => (
    <TableContext.Provider value={{ variant, density }}>
      <div
        data-table-variant={variant}
        data-table-density={density}
        className={cn(
          "relative block w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden rounded-[calc(var(--radius-md)-2px)] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.68)] overscroll-x-contain touch-pan-x shadow-[inset_0_1px_0_hsl(0_0%_100%/0.5)] [-webkit-overflow-scrolling:touch] [scrollbar-gutter:stable] [contain:layout_paint]",
          variant === "evidence" && "bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.62),0_20px_42px_-34px_hsl(var(--surface-shadow)/0.3)]",
          wrapperClassName,
        )}
      >
        <table
          ref={ref}
          className={cn(
            "type-table w-full min-w-full table-auto border-collapse caption-bottom text-sm [&_td]:border-x-0 [&_th]:border-x-0",
            className,
          )}
          {...props}
        />
      </div>
    </TableContext.Provider>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn("sticky top-0 z-10 bg-[hsl(var(--surface-elevated)/0.96)] backdrop-blur", className)}
      {...props}
    />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn("border-t border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-muted)/0.7)] font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => {
    const { variant } = useTableContext();
    return (
      <tr
        ref={ref}
        className={cn(
          "border-b border-[hsl(var(--border)/0.1)] motion-standard data-[state=selected]:bg-[hsl(var(--brand-accent-ghost)/0.52)]",
          variant === "evidence"
            ? "hover:bg-[linear-gradient(90deg,hsl(var(--brand-accent-ghost)/0.32),transparent)]"
            : "hover:bg-[hsl(var(--surface-muted)/0.58)]",
          className,
        )}
        {...props}
      />
    );
  },
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const { variant, density } = useTableContext();
    return (
      <th
        ref={ref}
        className={cn(
          "type-table-head sticky top-0 z-10 whitespace-nowrap border-b border-b-[hsl(var(--border)/0.14)] bg-[hsl(var(--surface-elevated)/0.96)] text-left align-middle text-[11px] leading-[14px] text-[hsl(var(--brand-accent))] backdrop-blur [&:has([role=checkbox])]:pr-0",
          density === "compact" ? "h-10 px-3" : "h-12 px-4",
          variant === "evidence" && "bg-[linear-gradient(180deg,hsl(var(--surface-elevated))_0%,hsl(var(--surface-panel))_100%)] text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const { density } = useTableContext();
    return (
      <td
        ref={ref}
        className={cn(
          density === "compact" ? "px-3 py-2.5" : "p-3.5",
          "align-middle text-sm text-foreground [&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      />
    );
  },
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
