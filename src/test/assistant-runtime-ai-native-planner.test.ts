import { describe, expect, it, vi } from "vitest";

import {
  buildAiNativeSchemaMap,
  executeSqlEvidenceJobWithRepair,
  normalizeAiEvidencePlan,
} from "../../supabase/functions/_shared/assistant-ai-native-planner";
import { buildCatalog } from "../../supabase/functions/_shared/assistant-query-engine";
import { planAnswerEvidence } from "../../supabase/functions/_shared/answer-planner";

function catalog() {
  return buildCatalog({
    total_rows: 50,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: ["2026-01-31"] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["NG", "US"] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: ["Spotify"] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [120] },
      { field_key: "share_pct", inferred_type: "number", coverage_pct: 40, source: "canonical", sample_values: [50] },
    ],
    aliases: {
      territory: ["location", "country", "market"],
      platform: ["dsp", "service"],
      net_revenue: ["revenue", "earnings"],
      share_pct: ["split", "ownership"],
    },
  });
}

describe("AI-native assistant runtime helpers", () => {
  it("builds a live schema map with aliases, samples, approved surfaces, and original question grounding", () => {
    const schemaMap = buildAiNativeSchemaMap({
      catalog: catalog(),
      mode: "workspace",
      question: "Which locations and DSPs made the most revenue?",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(schemaMap.original_question).toBe("Which locations and DSPs made the most revenue?");
    expect(schemaMap.approved_relations).toEqual(expect.arrayContaining(["scoped_core", "scoped_custom", "schema_json", "scoped_columns"]));
    expect(schemaMap.domain_mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ phrase: "location", field_key: "territory" }),
      expect.objectContaining({ phrase: "DSP", field_key: "platform" }),
    ]));
    expect(schemaMap.columns.find((column) => column.field_key === "territory")?.aliases).toContain("location");
  });

  it("normalizes LLM evidence plans while preserving the original question on every SQL job", () => {
    const plan = normalizeAiEvidencePlan({
      raw: {
        intent: "market_performance",
        answer_goal: "Find markets and platforms driving revenue",
        sql_jobs: [
          {
            job_id: "territory-context",
            purpose: "show market revenue",
            sub_question: "Which locations drove revenue?",
            required_for_answer: false,
            requirement: "supporting",
            expected_contribution: "Ranks territories by revenue",
            sql: "SELECT territory, SUM(net_revenue)::numeric AS net_revenue FROM scoped_core GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
          },
        ],
        sidecar_jobs: [{ job_id: "rights-splits", kind: "rights_splits", purpose: "attach split evidence", required_for_answer: false }],
      },
      question: "Which locations and DSPs made the most revenue?",
      fallback: {
        intent: "fallback",
        answer_goal: "fallback",
        audience_mode: "general",
        sub_questions: [],
        answer_requirements: [],
        evidence_jobs: [],
        synthesis_requirements: [],
        answer_sections: [],
        sql_jobs: [],
        sidecar_jobs: [],
        external_context_policy: "forbidden",
        missing_evidence_policy: "block_if_required",
      },
    });

    expect(plan.intent).toBe("market_performance");
    expect(plan.sql_jobs[0]).toMatchObject({
      original_question: "Which locations and DSPs made the most revenue?",
      sub_question: "Which locations drove revenue?",
      expected_contribution: "Ranks territories by revenue",
    });
    expect(plan.missing_evidence_policy).toBe("degrade_with_caveat");
  });

  it("repairs failed LLM SQL once while passing the exact question, failed SQL, error, and schema map", async () => {
    const schemaMap = buildAiNativeSchemaMap({
      catalog: catalog(),
      mode: "workspace",
      question: "Which locations made the most revenue?",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    const runSql = vi
      .fn()
      .mockRejectedValueOnce(new Error("column location does not exist"))
      .mockResolvedValueOnce({
        columns: ["territory", "net_revenue"],
        rows: [{ territory: "NG", net_revenue: 100 }],
        row_count: 1,
      });
    const repairSql = vi.fn().mockResolvedValue({
      sql: "SELECT territory, SUM(net_revenue)::numeric AS net_revenue FROM scoped_core GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
    });

    const result = await executeSqlEvidenceJobWithRepair({
      job: {
        job_id: "territory-context",
        purpose: "show territory revenue",
        requirement: "supporting",
        required_for_answer: false,
        original_question: "Which locations made the most revenue?",
        sub_question: "Which locations made the most revenue?",
        expected_contribution: "Ranks territories by revenue",
        sql: "SELECT location, SUM(net_revenue)::numeric AS net_revenue FROM scoped_core GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
      },
      schemaMap,
      catalog: catalog(),
      runSql,
      repairSql,
    });

    expect(result.error).toBeUndefined();
    expect(result.repair_status).toBe("repaired");
    expect(result.row_count).toBe(1);
    expect(repairSql).toHaveBeenCalledWith(expect.objectContaining({
      original_question: "Which locations made the most revenue?",
      failed_sql: expect.stringContaining("territory"),
      error: "column location does not exist",
      schema_map: schemaMap,
    }));
  });

  it("keeps failed jobs as caveats instead of discarding successful evidence", async () => {
    const schemaMap = buildAiNativeSchemaMap({
      catalog: catalog(),
      mode: "workspace",
      question: "What did the song earn and what are the splits?",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    const revenue = await executeSqlEvidenceJobWithRepair({
      job: {
        job_id: "primary",
        purpose: "show revenue",
        requirement: "required",
        required_for_answer: true,
        original_question: "What did the song earn and what are the splits?",
        sub_question: "What did the song earn?",
        expected_contribution: "Revenue base for the answer",
        sql: "SELECT SUM(net_revenue)::numeric AS net_revenue FROM scoped_core LIMIT 1",
      },
      schemaMap,
      catalog: catalog(),
      runSql: vi.fn().mockResolvedValue({ columns: ["net_revenue"], rows: [{ net_revenue: 250 }], row_count: 1 }),
    });
    const splits = await executeSqlEvidenceJobWithRepair({
      job: {
        job_id: "split-context",
        purpose: "show split evidence",
        requirement: "supporting",
        required_for_answer: false,
        original_question: "What did the song earn and what are the splits?",
        sub_question: "What are the splits?",
        expected_contribution: "Adds payout split context if available",
        sql: "SELECT party_name, share_pct FROM scoped_core LIMIT 10",
      },
      schemaMap,
      catalog: catalog(),
      runSql: vi.fn().mockRejectedValue(new Error("column party_name does not exist")),
    });

    expect(revenue.verifier_status).toBe("passed");
    expect(splits.verifier_status).toBe("failed");
    expect(splits.error).toContain("party_name");
    expect(revenue.rows[0].net_revenue).toBe(250);
  });

  it("fills weak LLM analysis plans with legacy inferred fields instead of accepting empty evidence requirements", () => {
    const fallback = planAnswerEvidence({
      question: "Which locations or markets should we focus on for revenue?",
      catalog: catalog(),
      mode: "workspace",
    });

    const plan = normalizeAiEvidencePlan({
      raw: {
        sql_jobs: [
          {
            job_id: "market-context",
            purpose: "show market opportunity",
            sub_question: "Which locations or markets should we focus on for revenue?",
            analysis_plan: {
              intent: "market_focus",
              metrics: [],
              dimensions: [],
              required_columns: [],
            },
          },
        ],
      },
      question: "Which locations or markets should we focus on for revenue?",
      catalog: catalog(),
      mode: "workspace",
      fallback,
    });

    expect(plan.sql_jobs[0].analysis_plan.dimensions).toContain("territory");
    expect(plan.sql_jobs[0].analysis_plan.metrics).toContain("net_revenue");
    expect(plan.sql_jobs[0].analysis_plan.required_columns).toEqual(
      expect.arrayContaining(["territory", "net_revenue"]),
    );
  });

  it("executes compiled legacy SQL before raw LLM SQL so bad LLM field names cannot hide usable evidence", async () => {
    const schemaMap = buildAiNativeSchemaMap({
      catalog: catalog(),
      mode: "workspace",
      question: "Which locations made the most revenue?",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    const runSql = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.toLowerCase().includes("location")) throw new Error("column location does not exist");
      return {
        columns: ["territory", "net_revenue"],
        rows: [{ territory: "NG", net_revenue: 100 }],
        row_count: 1,
      };
    });

    const result = await executeSqlEvidenceJobWithRepair({
      job: {
        job_id: "market-context",
        purpose: "show territory revenue",
        requirement: "supporting",
        required_for_answer: false,
        original_question: "Which locations made the most revenue?",
        sub_question: "Which locations made the most revenue?",
        expected_contribution: "Ranks territories by revenue",
        analysis_plan: {
          intent: "territory_analysis",
          metrics: ["net_revenue"],
          dimensions: ["territory"],
          filters: [],
          grain: "none",
          time_window: "implicit",
          confidence: "high",
          required_columns: ["territory", "net_revenue"],
          top_n: 10,
          sort_by: "net_revenue",
          sort_dir: "desc",
        },
        sql: "SELECT location, SUM(net_revenue)::numeric AS net_revenue FROM scoped_core GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
        sql_source: "llm",
      },
      schemaMap,
      catalog: catalog(),
      runSql,
    });

    expect(result.error).toBeUndefined();
    expect(result.row_count).toBe(1);
    expect(result.sql_preview.toLowerCase()).toContain("territory");
    expect(result.sql_preview.toLowerCase()).not.toContain("location");
    expect(runSql).toHaveBeenCalledTimes(1);
  });
});
