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
    test: (pathname) => /^\/insights\/[^/]+/.test(pathname),
    meta: {
      title: "Track Insights",
      subtitle: "Use AI to ask forward-looking questions and decide next actions for this track.",
    },
  },
  {
    test: (pathname) => pathname === "/insights",
    meta: {
      title: "Insights",
      subtitle: "Prioritize tracks, understand performance, and open track-level insights.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/activate"),
    meta: {
      title: "Activation",
      subtitle: "Choose a plan or redeem a partner code to unlock workspace access.",
    },
  },
  {
    test: (pathname) =>
      pathname.startsWith("/workspace") || pathname.startsWith("/company") || pathname.startsWith("/admin/invites"),
    meta: {
      title: "Workspace",
      subtitle: "Workspace identity, team access, and onboarding controls.",
    },
  },
  {
    test: (pathname) => pathname.startsWith("/settings"),
    meta: {
      title: "Settings",
      subtitle: "Profile, authentication, and account preferences.",
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
