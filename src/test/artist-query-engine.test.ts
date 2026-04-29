import {
  buildCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  resolveColumnByAlias,
  validatePlannedSql,
  verifyQueryResult,
} from "@/lib/artist-query-engine";

function sampleCatalog() {
  return buildCatalog({
    total_rows: 100,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "artist_name", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "rights_type", inferred_type: "text", coverage_pct: 95, source: "canonical", sample_values: [] },
      { field_key: "mapping_confidence", inferred_type: "number", coverage_pct: 90, source: "canonical", sample_values: [] },
      { field_key: "validation_status", inferred_type: "text", coverage_pct: 88, source: "canonical", sample_values: [] },
      { field_key: "streams_count", inferred_type: "number", coverage_pct: 70, source: "custom", sample_values: [] },
    ],
    aliases: {
      platform: ["dsp", "service"],
      net_revenue: ["revenue", "money"],
      streams_count: ["streams", "plays"],
    },
  });
}

describe("artist query engine", () => {
  // ─── Core plan derivation ──────────────────────────────────────────────────

  it("derives platform + revenue plan from natural phrasing", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Which DSP drove the most revenue this quarter?", catalog);
    expect(plan.required_columns).toContain("platform");
    expect(plan.required_columns).toContain("net_revenue");
    expect(plan.top_n).toBeGreaterThan(0);
    expect(plan.sort_dir).toBe("desc");
  });

  it("derives ascending sort for worst/poorest questions", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Which track is performing the worst?", catalog);
    expect(plan.sort_dir).toBe("asc");
    expect(plan.dimensions).toContain("track_title");
  });

  it("derives track_title dimension for track performance questions", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("What track is performing poorly for this artist?", catalog);
    expect(plan.dimensions).toContain("track_title");
  });

  it("derives artist ranking for attention questions instead of a catalog-wide total", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Which artists deserve immediate attention?", catalog);
    expect(plan.dimensions).toContain("artist_name");
    expect(plan.metrics).toContain("net_revenue");
    const compiled = compileSqlFromPlan(plan, catalog);
    expect(compiled.sql.toLowerCase()).toContain("r.artist_name as artist_name");
    expect(compiled.sql.toLowerCase()).toContain("group by 1");
  });

  it("derives territory evidence for touring questions", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Where should this artiste tour next quarter?", catalog);
    expect(plan.dimensions).toContain("territory");
    expect(plan.metrics).toContain("net_revenue");
    const compiled = compileSqlFromPlan(plan, catalog);
    expect(compiled.sql.toLowerCase()).toContain("r.territory as territory");
  });

  it("compiles explicit calendar-year comparisons instead of last/prior relative windows", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("compare 2024 revenuee to 2025 revenue", catalog);
    expect(plan.intent).toBe("period_comparison");
    const compiled = compileSqlFromPlan(plan, catalog);
    const sql = compiled.sql.toLowerCase();
    expect(sql).toContain("extract(year from c.event_date)");
    expect(sql).toContain("2024");
    expect(sql).toContain("2025");
    expect(sql).not.toContain("last_90_days");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });

  // ─── SQL compilation ───────────────────────────────────────────────────────

  it("compiles guarded SQL from plan", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Platform revenue trend over time", catalog);
    const compiled = compileSqlFromPlan(plan, catalog);
    expect(compiled.sql.toLowerCase()).toContain("with row_enriched");
    expect(compiled.sql.toLowerCase()).toContain("limit");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });

  it("does not compile source_kind filters when the catalog does not expose source_kind", () => {
    const catalog = sampleCatalog();

    const revenuePlan = deriveAnalysisPlanFallback("How much revenue did this artist make?", catalog);
    const revenueSql = compileSqlFromPlan(revenuePlan, catalog).sql.toLowerCase();
    expect(revenueSql).not.toContain("source_kind");

    const comparisonPlan = deriveAnalysisPlanFallback("Compare last 90 days revenue versus prior period", catalog);
    const comparisonSql = compileSqlFromPlan(comparisonPlan, catalog).sql.toLowerCase();
    expect(comparisonSql).not.toContain("source_kind");
    expect(() => validatePlannedSql(comparisonSql)).not.toThrow();
  });

  it("keeps source_kind filters when source_kind is available in the catalog", () => {
    const catalog = buildCatalog({
      ...sampleCatalog(),
      columns: [
        ...sampleCatalog().columns,
        { field_key: "source_kind", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      ],
    });
    const plan = deriveAnalysisPlanFallback("How much revenue did this artist make?", catalog);
    const sql = compileSqlFromPlan(plan, catalog).sql.toLowerCase();
    expect(sql).toContain("source_kind");
  });

  it("rejects dangerous SQL constructs", () => {
    expect(() => validatePlannedSql("select * from x; drop table y")).toThrow();
    expect(() => validatePlannedSql("select * from public.foo")).toThrow();
    expect(() => validatePlannedSql("/*hack*/ select 1")).toThrow();
  });

  // ─── Alias resolution ─────────────────────────────────────────────────────

  it("resolves exact field_key directly", () => {
    const catalog = sampleCatalog();
    expect(resolveColumnByAlias("platform", catalog)).toBe("platform");
    expect(resolveColumnByAlias("net_revenue", catalog)).toBe("net_revenue");
  });

  it("resolves column by alias name", () => {
    const catalog = sampleCatalog();
    // 'dsp' is an alias for 'platform'; 'revenue' is an alias for 'net_revenue'
    expect(resolveColumnByAlias("dsp", catalog)).toBe("platform");
    expect(resolveColumnByAlias("revenue", catalog)).toBe("net_revenue");
    expect(resolveColumnByAlias("streams", catalog)).toBe("streams_count");
  });

  it("resolves via partial token match", () => {
    const catalog = sampleCatalog();
    // 'streams_count' contains the token 'streams'
    expect(resolveColumnByAlias("stream count", catalog)).toBe("streams_count");
  });

  it("returns null for completely unknown column names", () => {
    const catalog = sampleCatalog();
    expect(resolveColumnByAlias("zzzunknownfield", catalog)).toBeNull();
  });

  // ─── Verifier (rows-first) ─────────────────────────────────────────────────

  it("PASSES verifier when platform asked but platform not in result columns — rows exist", () => {
    // Old behavior: FAIL. New behavior: PASS with a warning because rows exist.
    const status = verifyQueryResult({
      question: "Top platform by revenue?",
      columns: ["territory", "net_revenue"],
      rows: [{ territory: "US", net_revenue: 100 }],
    });
    expect(status.status).toBe("passed");
  });

  it("PASSES verifier when revenue is null in result — rows exist but revenue is zero", () => {
    // Old behavior: FAIL. New behavior: PASS with a warning because rows exist.
    const status = verifyQueryResult({
      question: "Show revenue trend by month",
      columns: ["month_start", "net_revenue"],
      rows: [{ month_start: "2025-01-01", net_revenue: null }],
    });
    expect(status.status).toBe("passed");
    expect(status.warnings?.some((w) => w.includes("revenue"))).toBe(true);
  });

  it("FAILS verifier only when zero rows returned", () => {
    const status = verifyQueryResult({
      question: "What platform made the most revenue?",
      columns: ["platform", "net_revenue"],
      rows: [],
    });
    expect(status.status).toBe("failed");
    expect(status.reason).toBe("no_rows_returned");
  });

  it("passes verifier on valid platform revenue trend output", () => {
    const status = verifyQueryResult({
      question: "Platform revenue trend",
      columns: ["month_start", "platform", "net_revenue"],
      rows: [
        { month_start: "2025-01-01", platform: "Spotify", net_revenue: 1200 },
        { month_start: "2025-02-01", platform: "Spotify", net_revenue: 1400 },
      ],
    });
    expect(status.status).toBe("passed");
    expect(status.warnings?.length ?? 0).toBe(0);
  });

  it("passes verifier with warnings when top_n is exceeded", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Show top 3 tracks by revenue", catalog);
    expect(plan.top_n).toBe(3);
    const status = verifyQueryResult({
      question: "Show top 3 tracks by revenue",
      plan,
      columns: ["track_title", "net_revenue"],
      rows: [
        { track_title: "A", net_revenue: 10 },
        { track_title: "B", net_revenue: 9 },
        { track_title: "C", net_revenue: 8 },
        { track_title: "D", net_revenue: 7 },
      ],
    });
    // Non-empty result always passes; top_n violation becomes a warning
    expect(status.status).toBe("passed");
    expect(status.warnings?.some((w) => w.includes("rows"))).toBe(true);
  });

  // ─── Special intents ───────────────────────────────────────────────────────

  it("supports opportunity and data risk intent with deterministic SQL", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Show tracks with highest opportunity and highest data risk", catalog);
    const compiled = compileSqlFromPlan(plan, catalog);
    expect(plan.intent).toBe("opportunity_risk_tracks");
    expect(compiled.sql.toLowerCase()).toContain("opportunity_score");
    expect(compiled.sql.toLowerCase()).toContain("data_risk_ratio");
  });

  it("maps highest-opportunity phrasing to opportunity intent without hardcoded prompt text", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback("Show tracks with highest opportunity", catalog);
    expect(plan.intent).toBe("opportunity_risk_tracks");
    expect(plan.required_columns).toContain("track_title");
    expect(plan.required_columns).toContain("mapping_confidence");
  });

  it("creates rights leakage plan with rights dimensions and revenue metrics", () => {
    const catalog = sampleCatalog();
    const plan = deriveAnalysisPlanFallback(
      "Which rights types are causing payout leakage this quarter and what should we fix first?",
      catalog,
    );
    expect(plan.intent).toBe("rights_leakage");
    expect(plan.required_columns).toContain("rights_type");
    expect(plan.required_columns).toContain("net_revenue");
    const compiled = compileSqlFromPlan(plan, catalog);
    expect(compiled.sql.toLowerCase()).toContain("effective_royalty_rate");
    expect(() => validatePlannedSql(compiled.sql)).not.toThrow();
  });
});
