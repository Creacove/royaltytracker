import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260428110000_ai_native_evidence_planning_v1.sql",
);

describe("AI-native evidence planning migration", () => {
  it("adds typed split claims and assistant-facing fact surfaces", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_split_claims");
    expect(sql).toContain("source_rights_code TEXT");
    expect(sql).toContain("canonical_rights_stream TEXT");
    expect(sql).toContain("share_pct NUMERIC");
    expect(sql).toContain("review_status TEXT");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_revenue_fact_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_split_claim_fact_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_rights_position_fact_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_allocation_fact_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_document_evidence_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_entity_resolution_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_data_quality_fact_v1");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.run_workspace_evidence_plan_v1");
  });
});
