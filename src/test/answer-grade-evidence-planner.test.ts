import { describe, expect, it } from "vitest";

import { buildCatalog } from "../../supabase/functions/_shared/assistant-query-engine";
import { planAnswerEvidence } from "../../supabase/functions/_shared/answer-planner";

function catalog() {
  return buildCatalog({
    total_rows: 500,
    columns: [
      { field_key: "event_date", inferred_type: "date", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "track_title", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "artist_name", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "project_title", inferred_type: "text", coverage_pct: 90, source: "canonical", sample_values: [] },
      { field_key: "territory", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "platform", inferred_type: "text", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "net_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "gross_revenue", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "quantity", inferred_type: "number", coverage_pct: 100, source: "canonical", sample_values: [] },
      { field_key: "party_name", inferred_type: "text", coverage_pct: 75, source: "canonical", sample_values: [] },
      { field_key: "share_pct", inferred_type: "number", coverage_pct: 75, source: "canonical", sample_values: [] },
      { field_key: "basis_type", inferred_type: "text", coverage_pct: 75, source: "canonical", sample_values: [] },
      { field_key: "validation_status", inferred_type: "text", coverage_pct: 80, source: "canonical", sample_values: [] },
      { field_key: "mapping_confidence", inferred_type: "number", coverage_pct: 80, source: "canonical", sample_values: [] },
    ],
    aliases: {
      project_title: ["project", "album"],
      platform: ["dsp", "service"],
      territory: ["market", "country"],
      net_revenue: ["revenue", "earnings"],
    },
  });
}

describe("planAnswerEvidence", () => {
  it("keeps simple revenue questions to one strong SQL job", () => {
    const plan = planAnswerEvidence({
      question: "Which tracks drove the most revenue this quarter?",
      catalog: catalog(),
      mode: "workspace",
    });

    expect(plan.sql_jobs).toHaveLength(1);
    expect(plan.sql_jobs[0]).toMatchObject({
      job_id: "primary",
      purpose: "answer the main revenue question",
      required_for_answer: true,
    });
    expect(plan.sidecar_jobs).toEqual([]);
  });

  it("decomposes complex questions into multiple legacy-compatible SQL jobs", () => {
    const plan = planAnswerEvidence({
      question: "For this artist, which projects grew, which territories and platforms drove it, and what changed over time?",
      catalog: catalog(),
      mode: "artist",
    });

    expect(plan.sql_jobs.map((job) => job.job_id)).toEqual(
      expect.arrayContaining(["primary", "territory-context", "platform-context", "trend-context"]),
    );
    expect(plan.answer_requirements).toEqual(
      expect.arrayContaining(["rank revenue drivers", "explain territory contribution", "explain platform contribution", "explain time movement"]),
    );
    expect(plan.sql_jobs.every((job) => job.analysis_plan.required_columns.length > 0)).toBe(true);
  });

  it("treats rights and split evidence as sidecar context instead of a global blocker", () => {
    const plan = planAnswerEvidence({
      question: "What revenue supports this writer payout, and do the splits prove the exact amount?",
      catalog: catalog(),
      mode: "workspace",
    });

    expect(plan.sql_jobs.map((job) => job.job_id)).toContain("primary");
    expect(plan.sidecar_jobs.map((job) => job.kind)).toEqual(
      expect.arrayContaining(["rights_splits", "source_documents"]),
    );
    expect(plan.missing_evidence_policy).toBe("degrade_with_caveat");
  });

  it("emits an answer-grade plan with sub-questions, job graph, and synthesis sections", () => {
    const plan = planAnswerEvidence({
      question:
        "For this track, compare June revenue to April, which platforms drove the higher month, why might it have happened, and what do the writers get?",
      catalog: catalog(),
      mode: "track",
    });

    expect(plan.answer_goal).toMatch(/compare/i);
    expect(plan.audience_mode).toBe("rights_admin");
    expect(plan.sub_questions.map((question) => question.id)).toEqual(
      expect.arrayContaining(["period-comparison", "platform-drivers", "explanation", "entitlement"]),
    );
    expect(plan.evidence_jobs.map((job) => job.job_id)).toEqual(
      expect.arrayContaining(["primary", "platform-context", "trend-context", "rights-splits"]),
    );
    expect(plan.evidence_jobs.find((job) => job.job_id === "rights-splits")).toMatchObject({
      type: "rights_splits",
      requirement: "supporting",
    });
    expect(plan.synthesis_requirements).toEqual(
      expect.arrayContaining([
        "answer every sub-question or attach a specific caveat",
        "cite evidence job ids for each answer section",
        "produce concrete next actions from the available evidence",
      ]),
    );
    expect(plan.answer_sections.map((section) => section.id)).toEqual(
      expect.arrayContaining(["direct_answer", "drivers", "entitlement", "caveats", "next_move"]),
    );
  });
});
