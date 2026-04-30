import { describe, expect, it } from "vitest";

import {
  buildFinalSynthesisPrompt,
  compactEvidenceForFinalSynthesis,
} from "../../supabase/functions/_shared/assistant-final-synthesis";

describe("final AI synthesis contract", () => {
  it("keeps mode-scoped evidence jobs separated for the final AI writer", () => {
    const compacted = compactEvidenceForFinalSynthesis({
      question: "Which platforms are driving revenue growth for this artist?",
      mode: "artist",
      entityContext: { artist_name: "Zara Hughes", artist_key: "artist:zara" },
      evidenceBundle: {
        evidence_answer_pack: {
          question_intent: {
            objective: "platform_revenue_ranking",
            normalized_question: "which platform are driving revenue growth for this artist?",
            mode: "artist",
            required_slots: [],
            optional_slots: [],
          },
          evidence_slots: [],
          primary_slot_id: "platform_revenue_rank",
          supporting_slot_ids: ["trend_revenue"],
          caveats: [],
          verified_answer_inputs: {
            primary_job_id: "platform-context",
            primary_columns: ["platform", "net_revenue"],
            primary_rows: [{ platform: "TV", net_revenue: 5553.78 }],
          },
          has_usable_evidence: true,
          diagnostics: {
            successful_job_ids: ["platform-context", "trend-context"],
            failed_job_ids: [],
            empty_job_ids: [],
            selected_primary_job_id: "platform-context",
          },
        },
        sql_evidence_jobs: [
          {
            job_id: "platform-context",
            purpose: "show platform contribution for the same question",
            requirement: "required",
            row_count: 3,
            columns: ["platform", "net_revenue", "growth_pct"],
            rows: [
              { platform: "TV", net_revenue: 5553.78, growth_pct: 44.2 },
              { platform: "Streaming", net_revenue: 455.22, growth_pct: 18.1 },
            ],
          },
          {
            job_id: "trend-context",
            purpose: "show time movement for the same question",
            requirement: "supporting",
            row_count: 2,
            columns: ["period_bucket", "net_revenue"],
            rows: [
              { period_bucket: "last_90_days", net_revenue: 6008.1 },
              { period_bucket: "prior_90_days", net_revenue: 4201.4 },
            ],
          },
        ],
        structured_sidecar_evidence: null,
      },
      webEnrichment: {
        status: "available",
        summary: "Short-form video and broadcast sync moments can amplify platform-led growth when tied to current audience behavior.",
        citations: [{ title: "Market note", url: "https://example.com" }],
      },
    });

    expect(compacted.mode).toBe("artist");
    expect(compacted.evidence_sources.map((source) => source.job_id)).toEqual([
      "platform-context",
      "trend-context",
    ]);
    expect(compacted.evidence_sources[0].rows[0]).toMatchObject({ platform: "TV" });
    expect(compacted.web_enrichment?.status).toBe("available");
  });

  it("builds a premium analyst final-writer prompt without collapsing evidence into one result", () => {
    const prompt = buildFinalSynthesisPrompt({
      question: "Where should this track make money next and what should we do?",
      mode: "track",
      entityContext: { track_title: "Midnight Signal", track_key: "isrc:123" },
      evidence_sources: [
        {
          job_id: "territory-context",
          purpose: "track-scoped territory revenue",
          requirement: "required",
          status: "passed",
          row_count: 2,
          columns: ["territory", "net_revenue"],
          rows: [{ territory: "GB", net_revenue: 14000 }],
          warnings: [],
          source_type: "sql",
        },
        {
          job_id: "platform-context",
          purpose: "track-scoped platform revenue",
          requirement: "supporting",
          status: "passed",
          row_count: 2,
          columns: ["platform", "net_revenue"],
          rows: [{ platform: "Spotify", net_revenue: 9000 }],
          warnings: [],
          source_type: "sql",
        },
      ],
      evidence_answer_pack: null,
      web_enrichment: null,
      caveats: [],
    });

    expect(prompt.systemPrompt).toContain("senior music-business analyst");
    expect(prompt.systemPrompt).toContain("why_this_matters");
    expect(prompt.userPrompt).toContain("territory-context");
    expect(prompt.userPrompt).toContain("platform-context");
    expect(prompt.userPrompt).not.toContain("\"result\"");
    expect(prompt.expectedJsonKeys).toEqual(expect.arrayContaining([
      "executive_answer",
      "why_this_matters",
      "synthesis_source",
      "quality_self_check",
    ]));
  });
});
