import { describe, expect, it } from "vitest";

import {
  buildEvidenceAnswerPack,
  inferQuestionIntent,
  selectPrimaryEvidenceJob,
} from "../../supabase/functions/_shared/assistant-evidence-contract";
import { buildDecisionGradeAnswer } from "../../supabase/functions/_shared/assistant-answer-policy";

const baseJob = {
  purpose: "test",
  requirement: "supporting",
  required_for_answer: false,
  verifier_status: "passed",
  warnings: [],
  sql_hash: "hash",
  sql_preview: "select 1",
  sql_source: "legacy_compiler",
  repair_status: "not_needed",
};

describe("assistant evidence contract", () => {
  it("normalizes typo-heavy platform revenue questions into platform evidence intent", () => {
    const intent = inferQuestionIntent("which platforms are helping this artiste to make the most revevnue?", "artist");

    expect(intent.objective).toBe("platform_revenue_ranking");
    expect(intent.normalized_question).toContain("revenue");
    expect(intent.required_slots.map((slot) => slot.slot_id)).toContain("platform_revenue_rank");
  });

  it("selects platform evidence over total-only legacy rows for platform revenue questions", () => {
    const selected = selectPrimaryEvidenceJob({
      question: "which platforms are helping this artiste to make the most revevnue?",
      mode: "artist",
      jobs: [
        {
          ...baseJob,
          job_id: "legacy-primary",
          columns: ["net_revenue"],
          rows: [{ net_revenue: 3208911.71 }],
          row_count: 1,
        },
        {
          ...baseJob,
          job_id: "platform-context",
          columns: ["platform", "net_revenue"],
          rows: [
            { platform: "Spotify", net_revenue: 120000 },
            { platform: "Apple Music", net_revenue: 90000 },
          ],
          row_count: 2,
        },
      ],
    });

    expect(selected?.job_id).toBe("platform-context");
  });

  it("does not treat Unknown territory as a touring recommendation lead", () => {
    const pack = buildEvidenceAnswerPack({
      question: "where should this artiste tour next?",
      mode: "artist",
      jobs: [
        {
          ...baseJob,
          job_id: "territory-context",
          columns: ["territory", "net_revenue"],
          rows: [
            { territory: "Unknown", net_revenue: 84000000 },
            { territory: "US", net_revenue: 11000000 },
            { territory: "GB", net_revenue: 9000000 },
          ],
          row_count: 3,
        },
      ],
    });

    expect(pack.primary_slot_id).toBe("market_revenue_rank");
    expect(pack.verified_answer_inputs.primary_rows[0].territory).toBe("US");
    expect(pack.caveats.join(" ")).toMatch(/unknown territory/i);
  });

  it("keeps failed LLM evidence as diagnostics while successful legacy evidence remains usable", () => {
    const pack = buildEvidenceAnswerPack({
      question: "where should this artiste tour next?",
      mode: "artist",
      jobs: [
        {
          ...baseJob,
          job_id: "llm-sql-1",
          columns: ["net_revenue"],
          rows: [],
          row_count: 0,
          error: "bad SQL",
        },
        {
          ...baseJob,
          job_id: "legacy-primary",
          columns: ["territory", "net_revenue"],
          rows: [{ territory: "NG", net_revenue: 12500 }],
          row_count: 1,
        },
      ],
    });

    expect(pack.has_usable_evidence).toBe(true);
    expect(pack.diagnostics.failed_job_ids).toContain("llm-sql-1");
    expect(pack.diagnostics.successful_job_ids).toContain("legacy-primary");
  });
});

describe("decision-grade answer policy regressions", () => {
  it("answers platform revenue questions when platform rows exist even if revenue is misspelled", () => {
    const answer = buildDecisionGradeAnswer({
      question: "which platforms are helping this artiste to make the most revevnue?",
      mode: "artist",
      resolvedEntities: { artist_name: "Zara Hughes" },
      visual: {
        type: "table",
        columns: ["platform", "net_revenue"],
        rows: [
          { platform: "Spotify", net_revenue: 120000 },
          { platform: "Apple Music", net_revenue: 90000 },
        ],
      },
    });

    expect(answer.quality_outcome).toBe("pass");
    expect(answer.executive_answer).toMatch(/Spotify/);
    expect(answer.executive_answer).not.toMatch(/can't rank platforms|does not include platform/i);
  });

  it("does not recommend the selected artist as their own next focus", () => {
    const answer = buildDecisionGradeAnswer({
      question: "what should this artiste focus on next?",
      mode: "artist",
      resolvedEntities: { artist_name: "Zara Hughes" },
      visual: {
        type: "table",
        columns: ["artist_name", "net_revenue"],
        rows: [{ artist_name: "Zara Hughes", net_revenue: 35913731.33 }],
      },
    });

    expect(answer.quality_outcome).toBe("constrained");
    expect(answer.executive_answer).not.toMatch(/focus.*Zara Hughes|give immediate attention to Zara Hughes/i);
    expect(answer.missing_requirements).toContain("ranked_within_artist_driver");
  });

  it("treats workspace artist marketing-budget questions as artist ranking, not territory ranking", () => {
    const intent = inferQuestionIntent("which artiste deserve the marketing budget", "workspace");

    expect(intent.objective).toBe("artist_budget_allocation");
    expect(intent.required_slots.map((slot) => slot.slot_id)).toContain("artist_revenue_rank");
  });
});
