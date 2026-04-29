import { detectAiInsightsMode, isAiInsightsTurnResponse } from "@/lib/ai-insights-routing";

describe("ai insights routing policy", () => {
  it("keeps workspace mode for artist wording when no artist entity is selected", () => {
    const mode = detectAiInsightsMode("Which artist should we prioritize this week?", {});
    expect(mode).toBe("workspace-general");
  });

  it("routes neutral question to workspace mode", () => {
    const mode = detectAiInsightsMode("How are we performing overall?", {});
    expect(mode).toBe("workspace-general");
  });

  it("routes explicit track context to track mode", () => {
    const mode = detectAiInsightsMode("What should we do next?", { track_key: "isrc:abc123" });
    expect(mode).toBe("track");
  });
});

describe("ai insights response contract", () => {
  const base = {
    conversation_id: "conv_1",
    resolved_entities: {},
    answer_title: "Sample",
    executive_answer: "Sample answer",
    why_this_matters: "Sample reason",
    evidence: {
      row_count: 3,
      scanned_rows: 10,
      from_date: "2026-01-01",
      to_date: "2026-03-01",
      provenance: ["get_track_insights_list_v1"],
      system_confidence: "high",
    },
    actions: [{ label: "Open Transactions", href: "/transactions", kind: "primary" }],
    follow_up_questions: ["What changed month over month?"],
    visual: { type: "table", columns: ["track_title"], rows: [{ track_title: "Song A" }] },
    kpis: [{ label: "Net revenue", value: "$10,000" }],
  };

  it("validates track response shape", () => {
    expect(isAiInsightsTurnResponse({ ...base, resolved_mode: "track" })).toBe(true);
  });

  it("validates artist response shape", () => {
    expect(isAiInsightsTurnResponse({ ...base, resolved_mode: "artist" })).toBe(true);
  });

  it("validates workspace response shape", () => {
    expect(isAiInsightsTurnResponse({ ...base, resolved_mode: "workspace-general" })).toBe(true);
  });

  it("keeps artist regression fixture contract stable", () => {
    const artistFixture = {
      ...base,
      resolved_mode: "artist",
      resolved_entities: { artist_key: "artist:test", artist_name: "Test Artist" },
      diagnostics: {
        intent: "revenue_analysis",
        confidence: "high",
        used_fields: ["track_title", "net_revenue"],
        missing_fields: [],
        strict_mode: true,
      },
    };
    expect(isAiInsightsTurnResponse(artistFixture)).toBe(true);
    expect(artistFixture).toMatchObject({
      resolved_mode: "artist",
      resolved_entities: { artist_key: "artist:test", artist_name: "Test Artist" },
      evidence: { provenance: ["get_track_insights_list_v1"] },
    });
  });

  it("accepts adaptive answer blocks payload", () => {
    const adaptiveFixture = {
      ...base,
      resolved_mode: "artist",
      answer_blocks: [
        {
          id: "direct-answer",
          type: "direct_answer",
          priority: 1,
          source: "workspace_data",
          payload: { title: "Artist answer", text: "Prioritize top tracks in growth territories." },
        },
        {
          id: "kpi-strip",
          type: "kpi_strip",
          priority: 2,
          source: "workspace_data",
          payload: { items: [{ label: "Net revenue", value: "$100k" }] },
        },
      ],
      render_hints: {
        layout: "adaptive_card_stack",
        density: "expanded",
        visual_preference: "table",
        show_confidence_badges: true,
      },
      evidence_map: {
        "direct-answer": "workspace_data",
        "kpi-strip": "workspace_data",
      },
    };
    expect(isAiInsightsTurnResponse(adaptiveFixture)).toBe(true);
  });

  it("accepts prose-first answer design metadata for the current viewer contract", () => {
    const proseFixture = {
      ...base,
      resolved_mode: "workspace-general",
      render_hints: {
        layout: "prose_first",
        density: "expanded",
        visual_preference: "chart",
        show_confidence_badges: true,
        evidence_visibility: "collapsed",
        visible_artifact_ids: ["fallback-visual"],
        answer_depth: "deep",
      },
      answer_design: {
        capabilities: [
          "financial_performance",
          "market_and_platform_context",
          "executive_summary",
        ],
        depth: "deep",
        external_enrichment_allowed: true,
        evidence_visibility: "collapsed",
      },
    };

    expect(isAiInsightsTurnResponse(proseFixture)).toBe(true);
  });

  it("preserves answer-grade evidence contracts through the router boundary", () => {
    const answerGradeFixture = {
      ...base,
      resolved_mode: "workspace-general",
      answer_sections: [
        {
          id: "direct_answer",
          title: "Direct answer",
          content: "Prioritize Summer Voltage and Neon Machine.",
          evidence_job_ids: ["primary"],
          status: "supported",
        },
      ],
      evidence_bundle: {
        sql_evidence_jobs: [
          {
            job_id: "primary",
            purpose: "rank artists needing attention",
            requirement: "required",
            row_count: 5,
            columns: ["artist_name", "net_revenue"],
            rows: [{ artist_name: "Summer Voltage", net_revenue: 1992.48 }],
          },
        ],
        structured_sidecar_evidence: null,
      },
      job_diagnostics: [
        {
          job_id: "primary",
          type: "sql",
          status: "passed",
          row_count: 5,
          warnings: [],
        },
      ],
    };

    expect(isAiInsightsTurnResponse(answerGradeFixture)).toBe(true);
  });
});
