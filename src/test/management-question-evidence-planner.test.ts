import { describe, expect, it } from "vitest";

import { planAnswerEvidence } from "../../supabase/functions/_shared/answer-planner";
import {
  buildCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
  type ArtistCatalog,
} from "../../supabase/functions/_shared/assistant-query-engine";

function managementCatalog(): ArtistCatalog {
  return buildCatalog({
    total_rows: 1200,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: ["2024-12-31"] },
      { field_key: "artist_name", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["Artist A"] },
      { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["Song A"] },
      { field_key: "work_title", inferred_type: "text", coverage_pct: 95, source: "canonical", sample_values: ["Work A"] },
      { field_key: "party_name", inferred_type: "text", coverage_pct: 85, source: "canonical", sample_values: ["Writer A"] },
      { field_key: "share_pct", inferred_type: "number", coverage_pct: 82, source: "canonical", sample_values: [50] },
      { field_key: "share_kind", inferred_type: "text", coverage_pct: 80, source: "canonical", sample_values: ["payable"] },
      { field_key: "basis_type", inferred_type: "text", coverage_pct: 80, source: "canonical", sample_values: ["contract"] },
      { field_key: "rights_family", inferred_type: "text", coverage_pct: 90, source: "canonical", sample_values: ["publishing"] },
      { field_key: "rights_stream", inferred_type: "text", coverage_pct: 88, source: "canonical", sample_values: ["mechanical"] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["Spotify"] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["NG", "US", "GB"] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [2500] },
      { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [3200] },
      { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [15000] },
      { field_key: "source_kind", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["income"] },
      { field_key: "mapping_confidence", inferred_type: "number", coverage_pct: 70, source: "canonical", sample_values: [0.92] },
      { field_key: "validation_status", inferred_type: "text", coverage_pct: 70, source: "canonical", sample_values: ["valid"] },
    ],
    aliases: {
      territory: ["location", "country", "market", "region", "tour", "touring"],
      platform: ["dsp", "service", "streaming", "store", "channel"],
      net_revenue: ["revenue", "earnings", "royalties", "income"],
      gross_revenue: ["gross"],
      track_title: ["song", "track"],
      artist_name: ["artist", "artiste", "act"],
      party_name: ["writer", "publisher", "rightsholder", "payee"],
      share_pct: ["split", "share", "ownership"],
    },
  });
}

function planQuestion(question: string) {
  const catalog = managementCatalog();
  const primary = deriveAnalysisPlanFallback(question, catalog);
  const evidence = planAnswerEvidence({ question, catalog, mode: "workspace", primaryPlan: primary });
  return { catalog, primary, evidence };
}

function jobIds(question: string): string[] {
  return planQuestion(question).evidence.sql_jobs.map((job) => job.job_id);
}

function sqlFor(question: string): string {
  const { catalog, primary } = planQuestion(question);
  const compiled = compileSqlFromPlan(primary, catalog);
  validatePlannedSql(compiled.sql);
  return compiled.sql.toLowerCase();
}

describe("management question evidence planner", () => {
  it.each([
    {
      question: "Where should this artiste tour?",
      dimensions: ["territory"],
      metrics: ["net_revenue"],
      jobs: ["primary", "territory-context", "platform-context", "trend-context"],
      sidecars: ["external-context"],
    },
    {
      question: "Where should we focus our marketing budget next month?",
      dimensions: ["territory", "platform"],
      metrics: ["net_revenue"],
      jobs: ["primary", "territory-context", "platform-context", "trend-context"],
      sidecars: [],
    },
    {
      question: "What platforms are coming up right now?",
      dimensions: ["platform"],
      metrics: ["net_revenue"],
      jobs: ["primary", "platform-context", "trend-context"],
      sidecars: [],
    },
    {
      question: "Which tracks deserve attention from the label this quarter?",
      dimensions: ["track_title"],
      metrics: ["net_revenue"],
      jobs: ["primary"],
      sidecars: [],
    },
    {
      question: "What was this person's revenue in 2024 compared with 2023, and what factors drove the growth?",
      dimensions: ["event_date"],
      metrics: ["net_revenue"],
      jobs: ["primary", "trend-context", "platform-context", "territory-context"],
      sidecars: [],
    },
    {
      question: "Which countries are growing fastest for this artist?",
      dimensions: ["territory", "event_date"],
      metrics: ["net_revenue"],
      jobs: ["primary", "territory-context", "trend-context"],
      sidecars: [],
    },
    {
      question: "Which DSP should the label prioritize for playlist pitching?",
      dimensions: ["platform"],
      metrics: ["net_revenue"],
      jobs: ["primary", "platform-context"],
      sidecars: [],
    },
    {
      question: "Which songs are underperforming despite revenue potential?",
      dimensions: ["track_title"],
      metrics: ["net_revenue"],
      jobs: ["primary", "quality-context"],
      sidecars: ["data-quality"],
    },
    {
      question: "What is this writer getting from the catalog and are the splits correct?",
      dimensions: ["party_name"],
      metrics: ["share_pct"],
      jobs: ["primary", "revenue-context"],
      sidecars: ["rights-splits", "source-documents"],
    },
    {
      question: "Which releases should publishers push in markets where royalties are already moving?",
      dimensions: ["track_title", "territory"],
      metrics: ["net_revenue"],
      jobs: ["primary", "territory-context"],
      sidecars: [],
    },
  ])("plans value-rich evidence for: $question", ({ question, dimensions, metrics, jobs, sidecars }) => {
    const { catalog, primary, evidence } = planQuestion(question);
    const sql = compileSqlFromPlan(primary, catalog).sql.toLowerCase();

    for (const dimension of dimensions) {
      expect(primary.dimensions).toContain(dimension);
      expect(sql).toContain(dimension);
    }
    for (const metric of metrics) {
      expect(primary.metrics).toContain(metric);
      expect(sql).toContain(metric);
    }
    expect(evidence.sql_jobs.map((job) => job.job_id)).toEqual(expect.arrayContaining(jobs));
    expect(evidence.sidecar_jobs.map((job) => job.job_id)).toEqual(expect.arrayContaining(sidecars));
    expect(evidence.sql_jobs[0]).toMatchObject({ job_id: "primary", required_for_answer: true });
  });

  it("compiles the touring recommendation into territory revenue SQL that passes verification with rows", () => {
    const { catalog, primary, evidence } = planQuestion("Where should this artiste tour?");
    const territoryJob = evidence.sql_jobs.find((job) => job.job_id === "territory-context");

    expect(primary.intent).toBe("territory_analysis");
    expect(primary.required_columns).toEqual(expect.arrayContaining(["territory", "net_revenue"]));
    expect(territoryJob?.analysis_plan.dimensions).toContain("territory");

    const sql = sqlFor("Where should this artiste tour?");
    expect(sql).toContain("r.territory as territory");
    expect(sql).toContain("sum(coalesce(r.net_revenue");
    expect(sql).toContain("source_kind");

    const verified = verifyQueryResult({
      question: "Where should this artiste tour?",
      plan: primary,
      columns: ["territory", "net_revenue"],
      rows: [
        { territory: "NG", net_revenue: 12500 },
        { territory: "GB", net_revenue: 9200 },
      ],
    });
    expect(verified.status).toBe("passed");
    expect(verified.warnings ?? []).not.toContain("territory column not in output; result may be aggregated across all territories");
  });

  it("keeps publisher rights evidence as a caveat path while revenue SQL remains answerable", () => {
    const { catalog, primary, evidence } = planQuestion("What is this writer getting from the catalog and are the splits correct?");
    const revenueJob = evidence.sql_jobs.find((job) => job.job_id === "revenue-context");

    expect(primary.required_columns).toEqual(expect.arrayContaining(["party_name", "share_pct"]));
    expect(primary.metrics).toContain("net_revenue");
    expect(revenueJob).toBeDefined();
    expect(compileSqlFromPlan(revenueJob!.analysis_plan, catalog).sql.toLowerCase()).toContain("net_revenue");
    expect(evidence.sidecar_jobs.map((job) => job.job_id)).toEqual(expect.arrayContaining(["rights-splits", "source-documents"]));
    expect(evidence.missing_evidence_policy).toBe("degrade_with_caveat");
  });
});
