import { aggregateResults, scoreResult } from "../../scripts/artist-benchmark.mjs";

describe("artist benchmark scoring", () => {
  const basePrompt = {
    id: "p-1",
    question: "Where should this artiste tour and why?",
    persona: "tour_manager",
    intent: "touring_live",
    required_evidence: ["territory", "gross_revenue"],
    expected_depth: "deep",
    requires_external: true,
    expect_answerable: true,
  };

  const okRun = {
    context: { artist_key: "artist:test", from_date: "2025-01-01", to_date: "2026-01-01" },
    status: "ok",
    response: {
      executive_answer: "Priority touring territories are DE, JP, and NG based on monetization strength and volume.",
      why_this_matters: "Validate demand and venue holds before booking to reduce routing risk.",
      quality_outcome: "pass",
      diagnostics: { intent: "touring_live" },
      table: { columns: ["territory", "gross_revenue"], rows: [{ territory: "DE", gross_revenue: 100 }] },
      recommendations: [
        { action: "Prioritize live routing in DE, JP, NG." },
        { action: "Validate city-level demand concentration before holds." },
        { action: "Run market readiness checks before booking dates." },
      ],
      citations: [{ title: "Venue Trends", url: "https://example.com", source_type: "external" }],
    },
  };

  it("scores a strong touring answer with no critical flags", () => {
    const scored = scoreResult(basePrompt, okRun);
    expect(scored.status).toBe("ok");
    expect(scored.critical_flags.length).toBe(0);
    expect(scored.quality_score).toBeGreaterThanOrEqual(7);
    expect(scored.pass).toBe(true);
  });

  it("flags cross-intent drift when tour prompt receives rights remediation recommendations", () => {
    const driftRun = {
      ...okRun,
      response: {
        ...okRun.response,
        recommendations: [
          { action: "Run a rights-mapping audit first and fix validation status." },
        ],
      },
    };
    const scored = scoreResult(basePrompt, driftRun);
    expect(scored.safety_flags).toContain("cross_intent_recommendation_drift");
    expect(scored.critical_flags).toContain("cross_intent_recommendation_drift");
    expect(scored.pass).toBe(false);
  });

  it("fails gate when critical failures or quality thresholds are not met", () => {
    const rows = [
      { ...scoreResult(basePrompt, okRun), quality_score: 8.4, pass: true },
      {
        ...scoreResult(basePrompt, {
          ...okRun,
          status: "error",
          response: null,
        }),
        quality_score: 6.2,
        safety_flags: ["runtime_error"],
        critical_flags: ["runtime_error"],
        pass: false,
      },
    ];
    const aggregate = aggregateResults(rows);
    expect(aggregate.gate.pass).toBe(false);
    expect(aggregate.gate.critical_failure_count).toBeGreaterThan(0);
    expect(aggregate.summary.below_7_count).toBeGreaterThan(0);
  });
});
