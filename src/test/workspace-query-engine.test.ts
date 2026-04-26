import {
  buildCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
} from "../../supabase/functions/insights-workspace-chat/query_engine.ts";

function sampleWorkspaceCatalog() {
  return buildCatalog({
    total_rows: 240,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "artist_name", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "recording_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "recording_artist", inferred_type: "text", coverage_pct: 98, source: "canonical", sample_values: [] },
      { field_key: "work_title", inferred_type: "text", coverage_pct: 72, source: "canonical", sample_values: [] },
      { field_key: "party_name", inferred_type: "text", coverage_pct: 66, source: "canonical", sample_values: [] },
      { field_key: "share_pct", inferred_type: "number", coverage_pct: 58, source: "canonical", sample_values: [] },
      { field_key: "share_kind", inferred_type: "text", coverage_pct: 58, source: "canonical", sample_values: [] },
      { field_key: "basis_type", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "rights_family", inferred_type: "text", coverage_pct: 90, source: "canonical", sample_values: [] },
      { field_key: "rights_stream", inferred_type: "text", coverage_pct: 82, source: "canonical", sample_values: [] },
      { field_key: "confidence", inferred_type: "number", coverage_pct: 84, source: "canonical", sample_values: [] },
      { field_key: "is_conflicted", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "open_task_count", inferred_type: "number", coverage_pct: 44, source: "canonical", sample_values: [] },
      { field_key: "open_critical_task_count", inferred_type: "number", coverage_pct: 36, source: "canonical", sample_values: [] },
    ],
    aliases: {
      platform: ["dsp", "service"],
      track_title: ["song", "track"],
      recording_title: ["master"],
      work_title: ["work", "composition"],
      party_name: ["owner", "writer", "publisher", "rightsholder"],
      share_pct: ["share", "split", "ownership"],
      share_kind: ["registered_share", "payable_share"],
      rights_stream: ["rights_type"],
      net_revenue: ["revenue", "earnings", "money"],
    },
  });
}

describe("workspace query engine", () => {
  it("derives ownership plans from rights questions", () => {
    const catalog = sampleWorkspaceCatalog();
    const plan = deriveAnalysisPlanFallback("Who owns this work and what are the splits?", catalog);

    expect(plan.intent).toBe("rights_ownership");
    expect(plan.required_columns).toContain("party_name");
    expect(plan.required_columns).toContain("share_pct");
    expect(plan.required_columns).toContain("work_title");
  });

  it("derives entitlement plans for writer payout questions", () => {
    const catalog = sampleWorkspaceCatalog();
    const plan = deriveAnalysisPlanFallback("What is this writer getting from this song?", catalog);

    expect(plan.intent).toBe("entitlement_estimation");
    expect(plan.required_columns).toContain("party_name");
    expect(plan.required_columns).toContain("share_kind");
    expect(plan.required_columns).toContain("basis_type");
  });

  it("compiles income questions against income source rows only", () => {
    const catalog = sampleWorkspaceCatalog();
    const plan = deriveAnalysisPlanFallback("Which DSP drove the most revenue this quarter?", catalog);
    const compiled = compileSqlFromPlan(plan, catalog);

    expect(compiled.sql.toLowerCase()).toContain("source_kind");
    expect(compiled.sql.toLowerCase()).toContain("'income'");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });

  it("compiles rights ownership SQL against rights-aware columns", () => {
    const catalog = sampleWorkspaceCatalog();
    const plan = deriveAnalysisPlanFallback("Show me who owns which works and their split percentages.", catalog);
    const compiled = compileSqlFromPlan(plan, catalog);

    expect(compiled.sql.toLowerCase()).toContain("share_pct");
    expect(compiled.sql.toLowerCase()).toContain("party_name");
    expect(compiled.sql.toLowerCase()).toContain("'rights'");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });

  it("passes verifier with a warning when entitlement rows exist but payable math is unavailable", () => {
    const catalog = sampleWorkspaceCatalog();
    const plan = deriveAnalysisPlanFallback("What is this writer getting from this song?", catalog);
    const status = verifyQueryResult({
      question: "What is this writer getting from this song?",
      plan,
      columns: ["party_name", "work_title", "share_pct", "basis_type"],
      rows: [
        {
          party_name: "Writer A",
          work_title: "Song A",
          share_pct: 50,
          basis_type: "registered",
        },
      ],
    });

    expect(status.status).toBe("passed");
    expect(status.warnings?.some((warning) => warning.toLowerCase().includes("payable"))).toBe(true);
  });
});
