import {
  buildCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
} from "../../supabase/functions/insights-track-chat/query_engine.ts";

function sampleTrackCatalog() {
  return buildCatalog({
    total_rows: 120,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "recording_title", inferred_type: "text", coverage_pct: 96, source: "canonical", sample_values: [] },
      { field_key: "work_title", inferred_type: "text", coverage_pct: 70, source: "canonical", sample_values: [] },
      { field_key: "party_name", inferred_type: "text", coverage_pct: 62, source: "canonical", sample_values: [] },
      { field_key: "share_pct", inferred_type: "number", coverage_pct: 58, source: "canonical", sample_values: [] },
      { field_key: "share_kind", inferred_type: "text", coverage_pct: 58, source: "canonical", sample_values: [] },
      { field_key: "basis_type", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "rights_family", inferred_type: "text", coverage_pct: 92, source: "canonical", sample_values: [] },
      { field_key: "rights_stream", inferred_type: "text", coverage_pct: 84, source: "canonical", sample_values: [] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "source_kind", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "confidence", inferred_type: "number", coverage_pct: 88, source: "canonical", sample_values: [] },
      { field_key: "is_conflicted", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
    ],
    aliases: {
      track_title: ["song", "track"],
      work_title: ["work", "composition"],
      party_name: ["writer", "publisher", "rightsholder", "owner"],
      share_pct: ["share", "split", "ownership"],
      rights_stream: ["rights_type"],
      net_revenue: ["revenue", "earnings", "money"],
    },
  });
}

describe("track query engine parity", () => {
  it("derives ownership plans for rights questions", () => {
    const catalog = sampleTrackCatalog();
    const plan = deriveAnalysisPlanFallback("Who owns this work and what are the splits?", catalog);

    expect(plan.intent).toBe("rights_ownership");
    expect(plan.required_columns).toContain("party_name");
    expect(plan.required_columns).toContain("share_pct");
    expect(plan.required_columns).toContain("work_title");
  });

  it("derives entitlement plans for writer payout questions", () => {
    const catalog = sampleTrackCatalog();
    const plan = deriveAnalysisPlanFallback("What is this writer getting from this song?", catalog);

    expect(plan.intent).toBe("entitlement_estimation");
    expect(plan.required_columns).toContain("share_kind");
    expect(plan.required_columns).toContain("basis_type");
  });

  it("compiles rights ownership SQL against rights-aware source rows", () => {
    const catalog = sampleTrackCatalog();
    const plan = deriveAnalysisPlanFallback("Show me who owns this track and their split percentages.", catalog);
    const compiled = compileSqlFromPlan(plan, catalog);

    expect(compiled.sql.toLowerCase()).toContain("share_pct");
    expect(compiled.sql.toLowerCase()).toContain("party_name");
    expect(compiled.sql.toLowerCase()).toContain("'rights'");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });

  it("passes entitlement verification with a warning when payable math is unavailable", () => {
    const catalog = sampleTrackCatalog();
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
