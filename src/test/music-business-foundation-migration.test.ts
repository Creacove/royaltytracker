import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260423120000_music_business_copilot_foundation_v1.sql",
);

describe("music business copilot foundation migration", () => {
  it("adds the company-scoped catalog foundation and assistant read models without telemetry tables", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ALTER TABLE public.cmo_reports");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS company_id UUID");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_parties");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_works");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_recordings");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_claims");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_income_scope_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.assistant_rights_scope_v1");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.company_catalog_snapshot_v1");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.can_access_company_data");
    expect(sql).toContain("ON CONFLICT (company_id, isrc) WHERE isrc IS NOT NULL DO UPDATE");
    expect(sql).toContain("ON CONFLICT (company_id, iswc) WHERE iswc IS NOT NULL DO UPDATE");

    expect(sql).not.toContain("assistant_turns");
    expect(sql).not.toContain("assistant_usage_events");
    expect(sql).not.toContain("assistant_feedback_events");
  });
});
