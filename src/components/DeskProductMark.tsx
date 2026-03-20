import { cn } from "@/lib/utils";

type DeskProductMarkProps = {
  className?: string;
  logoClassName?: string;
  deskBadgeClassName?: string;
  descriptor?: string;
  compact?: boolean;
};

export function DeskProductMark({
  className,
  logoClassName,
  deskBadgeClassName,
  descriptor,
  compact = false,
}: DeskProductMarkProps) {
  return (
    <div className={cn("flex flex-col items-start gap-2", compact && "gap-1.5", className)}>
      <div className="flex items-center gap-2.5">
        <img
          src="/ordersounds-logo.png"
          alt="OrderSounds"
          className={cn("h-9 w-auto object-contain", compact && "h-7", logoClassName)}
        />

        <div
          className={cn(
            "relative inline-flex items-center self-center rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[linear-gradient(135deg,hsl(var(--surface-elevated))_0%,hsl(var(--brand-accent-ghost)/0.88)_100%)] pr-3.5 shadow-[0_16px_28px_-24px_hsl(var(--brand-accent)/0.42)]",
            compact ? "h-8 pl-3" : "h-9 pl-3.5",
            deskBadgeClassName,
          )}
        >
          <span className="absolute left-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand-accent))]" />
          <span className="absolute inset-y-1.5 left-[0.62rem] w-px bg-[linear-gradient(180deg,transparent,hsl(var(--brand-accent)/0.55),transparent)]" />
          <span
            className={cn(
              "type-display-section leading-none tracking-[0.02em] text-foreground",
              compact ? "text-[1rem]" : "text-[1.15rem]",
            )}
          >
            Desk
          </span>
        </div>
      </div>

      {descriptor ? (
        <p className={cn("editorial-caption text-left text-[10px] tracking-[0.05em] text-muted-foreground", compact && "text-[9px]")}>
          {descriptor}
        </p>
      ) : null}
    </div>
  );
}
