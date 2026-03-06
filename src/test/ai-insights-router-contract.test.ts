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
});
