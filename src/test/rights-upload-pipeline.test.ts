import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("rights upload pipeline orchestration", () => {
  it("routes pure rights documents to split review instead of revenue-only stages", () => {
    const source = read("supabase/functions/reprocess-file/index.ts");

    expect(source).toContain('parser_lane === "rights"');
    expect(source).toContain('status: "rights_review_ready"');
    expect(source.indexOf('parser_lane === "rights"')).toBeLessThan(source.indexOf('invokeStage("run-normalization")'));
  });

  it("keeps validation document-family aware so rights documents are not failed for zero transactions", () => {
    const source = read("supabase/functions/run-validation/index.ts");

    expect(source).toContain("catalog_split_claims");
    expect(source).toContain('parser_lane === "rights"');
    expect(source).toContain("split_claims");
  });

  it("exposes a split-claim decision function that promotes approved claims into canonical rights data", () => {
    const functionPath = "supabase/functions/submit-split-claim-decisions/index.ts";
    expect(existsSync(path.resolve(process.cwd(), functionPath))).toBe(true);

    const source = read(functionPath);
    expect(source).toContain('type SplitDecisionAction = "approve" | "reject" | "keep_existing" | "replace_existing"');
    expect(source).toContain("source_report_id");
    expect(source).toContain("work_group_keys");
    expect(source).toContain('from("catalog_split_claims")');
    expect(source).toContain('from("catalog_works").upsert');
    expect(source).toContain('from("catalog_parties").upsert');
    expect(source).toContain('from("catalog_rights_positions").upsert');
    expect(source).toContain('from("catalog_resolution_events").insert');
  });
});
