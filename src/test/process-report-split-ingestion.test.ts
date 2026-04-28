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
});
