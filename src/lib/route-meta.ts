export interface RouteMeta {
  title: string;
  subtitle: string;
}

const routeMetaRegistry: Array<{ test: (pathname: string) => boolean; meta: RouteMeta }> = [
  {
    test: (pathname) => pathname === "/",
    meta: {
      title: "Overview",
      subtitle: "Revenue pulse, report progress, and CMO performance.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/reports"),
    meta: {
      title: "Statements",
      subtitle: "Upload, process, and inspect CMO statements.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/transactions"),
    meta: {
      title: "Transactions",
      subtitle: "Transaction history and validation issues in one workspace.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/review-queue"),
    meta: {
      title: "Statement Reviews",
      subtitle: "Resolve blocked items and confirm source evidence.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/insights"),
    meta: {
      title: "Track Insights",
      subtitle: "Track performance, risks, and opportunity.",
    },
  },
];

export function resolveRouteMeta(pathname: string): RouteMeta {
  const matched = routeMetaRegistry.find(({ test }) => test(pathname));
  if (matched) return matched.meta;
  return {
    title: "OrderSounds",
    subtitle: "Forensic royalty intelligence.",
  };
}
