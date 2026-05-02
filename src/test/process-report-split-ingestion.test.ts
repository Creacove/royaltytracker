import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const processReportPath = path.resolve(process.cwd(), "supabase/functions/process-report/index.ts");

describe("process-report split ingestion", () => {
  it("writes rights-lane rows to typed catalog split claims", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain("buildSplitClaimsFromRows");
    expect(source).toContain('.from("catalog_split_claims").insert');
    expect(source).toContain("source_language: \"fr\"");
    expect(source).toContain("source_rights_code");
  });

  it("prefers deterministic SACEM catalogue parsing before generic report item mapping", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain("extractSacemCatalogueRowsFromText");
    expect(source).toContain("Built ${rawRows.length} SACEM rights catalogue rows from OCR text");
    expect(source.indexOf("extractSacemCatalogueRowsFromText(document.text)")).toBeLessThan(
      source.indexOf("extractedItems.length > 0"),
    );
  });

  it("does not trust incomplete SACEM parser rows without share evidence", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain("function hasSplitShareEvidence");
    expect(source).toContain("sacemPdfRowsWithShares > 0");
    expect(source).toContain("falling back to Document AI");
    expect(source).toContain("sacemCatalogueRowsWithShares > 0");
  });

  it("clears prior rights claims before forced reprocessing to prevent duplicate split evidence", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain('.from("catalog_split_claims").delete().eq("source_report_id", report_id)');
    expect(source).toContain('.from("catalog_claims").delete().eq("source_report_id", report_id)');
  });

  it("maps custom extractor rights rows into work party evidence and constrained transaction vocabularies", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain("source_work_code: item.release_upc");
    expect(source).toContain("party_name: item.track_artist ?? item.release_artist");
    expect(source).toContain("rights_family: inferRightsFamily(r)");
    expect(source).toContain("rights_stream: normalizeRightsStream(r.usage_type ?? r.rights_type)");
    expect(source).toContain('documentFamily.parser_lane === "rights" || documentFamily.parser_lane === "mixed"');
  });

  it("keeps revenue routing separate from split-claim routing", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain('const shouldInsertTransactions = documentFamily.parser_lane === "income" || documentFamily.parser_lane === "mixed"');
    expect(source).toContain('if (documentFamily.parser_lane === "rights" || documentFamily.parser_lane === "mixed")');
    expect(source).toContain('rowHasExplicitSplitSignal(r as unknown as Record<string, unknown>) && !rowHasRevenueSignal(r as unknown as Record<string, unknown>)');
    expect(source).not.toContain('if (documentFamily.parser_lane !== "income")');
  });

  it("prefers recording metadata when ISRC and ISWC both appear on revenue rows", () => {
    const source = readFileSync(processReportPath, "utf8");

    expect(source).toContain('asset_class: inferAssetClass(r)');
    expect(source).toContain('function inferAssetClass');
    expect(source).toContain('if (row.isrc) return "recording"');
  });
});
