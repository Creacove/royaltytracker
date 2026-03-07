export interface RouteMeta {
  title: string;
  subtitle: string;
  fullWidth?: boolean;
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
      subtitle: "Explore normalized transaction history across CMOs and statements.",
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
    test: (pathname) => pathname.startsWith("/ai-insights/snapshots/track/"),
    meta: {
      title: "Track Snapshot",
      subtitle: "A fast publisher view of track performance, opportunity, and risk.",
      fullWidth: true,
    },
  },
  {
    test: (pathname) => pathname.startsWith("/ai-insights/snapshots/artist/"),
    meta: {
      title: "Artist Snapshot",
      subtitle: "A concise artist portfolio brief for revenue, momentum, and next decisions.",
      fullWidth: true,
    },
  },
  {
    test: (pathname) => pathname === "/ai-insights" || pathname.startsWith("/ai-insights/"),
    meta: {
      title: "AI Insights",
      subtitle: "Chat-first intelligence with evidence, actions, and workspace-aware recommendations.",
      fullWidth: true,
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
