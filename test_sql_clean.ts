import { buildCatalog, deriveAnalysisPlanFallback, compileSqlFromPlan, validatePlannedSql } from "./supabase/functions/insights-artist-chat/query_engine.ts";

const catalog = buildCatalog({
    total_rows: 100,
    columns: [
        { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
        { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
    ],
    aliases: {
        platform: ["dsp", "service"],
        net_revenue: ["revenue", "money"],
    },
});

function testSql(question: string) {
    console.log(`\n=== QUESTION: ${question} ===`);
    const plan = deriveAnalysisPlanFallback(question, catalog);

    // Actually we need to see what the GPT planner returns, but since we don't have GPT here we simulate
    // what it would return for "Which territories underperform for the top tracks?"
    const mockPlan = {
        intent: "compare",
        metrics: ["net_revenue"],
        dimensions: ["territory", "track_title"],
        filters: [],
        grain: "none",
        time_window: "all",
        confidence: "medium",
        required_columns: ["territory", "track_title", "net_revenue"],
        top_n: 5,
        sort_by: "net_revenue",
        sort_dir: "asc"
    };

    console.log("PLAN:", JSON.stringify(mockPlan, null, 2));
    const compiled = compileSqlFromPlan(mockPlan as any, catalog);
    console.log("SQL:");
    console.log(compiled.sql);

    try {
        validatePlannedSql(compiled.sql);
        console.log("VALIDATION: PASS");
    } catch (e: any) {
        console.log("VALIDATION: FAIL ->", e.message);
    }
}

testSql("Which territories underperform for the top tracks?");
