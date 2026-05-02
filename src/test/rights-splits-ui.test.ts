import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("rights and splits product surface", () => {
  it("registers rights and splits as a first-class workspace section", () => {
    const app = read("src/App.tsx");
    const layout = read("src/components/AppLayout.tsx");
    const routeMeta = read("src/lib/route-meta.ts");

    expect(app).toContain('path="/rights-splits"');
    expect(app).toContain("<RightsSplits />");
    expect(layout).toContain('to: "/rights-splits"');
    expect(layout).toContain('label: "Rights & Splits"');
    expect(routeMeta).toContain('pathname.startsWith("/rights-splits")');
    expect(routeMeta).toContain('title: "Rights & Splits"');
  });

  it("queries typed split claims and exposes review/provenance fields", () => {
    const page = read("src/pages/RightsSplits.tsx");

    expect(page).toContain('from("catalog_split_claims")');
    expect(page).toContain("source_report_id");
    expect(page).toContain("review_status");
    expect(page).toContain("source_rights_code");
    expect(page).toContain("canonical_rights_stream");
    expect(page).toContain("source_row_id");
  });

  it("renders rights evidence instead of transaction tables for rights documents", () => {
    const reports = read("src/pages/Reports.tsx");

    expect(reports).toContain("isRightsDocument");
    expect(reports).toContain('queryKey: ["report-split-claims"');
    expect(reports).toContain('from("catalog_split_claims")');
    expect(reports).toContain('TabsTrigger value="rights"');
    expect(reports).toContain("Split case summary");
  });

  it("lets existing typed split claims force the report detail into rights mode", () => {
    const reports = read("src/pages/Reports.tsx");

    expect(reports).toContain("selectedReportMetadataIsRightsDocument");
    expect(reports).toContain("selectedReportMetadataIsRightsDocument || reportSplitClaims.length > 0");
    expect(reports).not.toContain("enabled: !!selectedReport?.id && selectedReportIsRightsDocument");
  });

  it("lets operators approve or reject pending split claims from the rights review surface", () => {
    const page = read("src/pages/RightsSplits.tsx");

    expect(page).toContain('supabase.functions.invoke("submit-split-claim-decisions"');
    expect(page).toContain('action: "approve"');
    expect(page).toContain('action: "reject"');
    expect(page).toContain("Approve document");
    expect(page).toContain("Reject document");
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: [\"rights-splits-claims\"] })");
  });

  it("renders split cases instead of a per-claim approval table", () => {
    const page = read("src/pages/RightsSplits.tsx");

    expect(page).toContain("Split Cases");
    expect(page).toContain("Work Review");
    expect(page).toContain("Catalog Rights");
    expect(page).toContain("buildSplitCases");
    expect(page).toContain('setActiveTab("review")');
    expect(page).toContain("approvableWorkKeys");
    expect(page).not.toContain("<TableHead>PARTY</TableHead>");
    expect(page).not.toContain("filteredClaims.slice(0, 200).map");
  });

  it("updates report detail rights evidence to use grouped split case summaries", () => {
    const reports = read("src/pages/Reports.tsx");

    expect(reports).toContain("buildSplitCases");
    expect(reports).toContain("Split case summary");
    expect(reports).not.toContain('Table className="min-w-[1180px]"');
  });
});
