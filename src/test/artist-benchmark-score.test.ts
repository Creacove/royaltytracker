import { aggregateResults, applyRepetitionPenalty, scoreResult } from "../../scripts/artist-benchmark.mjs";

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

  it("flags intent-family mismatch when detected intent conflicts with prompt intent", () => {
    const mismatchRun = {
      ...okRun,
      response: {
        ...okRun.response,
        executive_answer: "Run a rights mapping audit and fix validation status before revenue decisions.",
        recommendations: [{ action: "Run a rights-mapping audit and fix validation status." }],
        diagnostics: { intent: "rights_leakage" },
      },
    };
    const scored = scoreResult(basePrompt, mismatchRun);
    expect(scored.safety_flags).toContain("intent_family_mismatch");
    expect(scored.critical_flags).toContain("intent_family_mismatch");
    expect(scored.pass).toBe(false);
  });

  it("flags summary/take collapse and template leakage in visible narrative", () => {
    const weakRun = {
      ...okRun,
      response: {
        ...okRun.response,
        executive_answer: "Below is a concise market-context brief for this artist. Data tabulate shows Germany is strongest.",
        why_this_matters: "Below is a concise market-context brief for this artist. Data tabulate shows Germany is strongest.",
      },
    };
    const scored = scoreResult(basePrompt, weakRun);
    expect(scored.safety_flags).toContain("summary_take_overlap");
    expect(scored.safety_flags).toContain("template_leakage");
    expect(scored.quality_breakdown.consistency).toBeLessThanOrEqual(5);
  });

  it("flags unknown anchor visibility when known entities exist in evidence", () => {
    const weakRun = {
      ...okRun,
      response: {
        ...okRun.response,
        executive_answer: "Unknown should be the top priority market right now.",
        why_this_matters: "Unknown leads the signal.",
        visual: {
          type: "table",
          columns: ["territory", "gross_revenue"],
          rows: [
            { territory: "Germany (DE)", gross_revenue: 100 },
            { territory: "Unknown", gross_revenue: 80 },
          ],
        },
      },
    };
    const scored = scoreResult(basePrompt, weakRun);
    expect(scored.safety_flags).toContain("unknown_anchor_visible");
    expect(scored.quality_breakdown.recommendation_relevance).toBeLessThanOrEqual(4);
  });

  it("applies repetition penalty when same recommendation appears too frequently", () => {
    const repeatedAction = "Audit and classify all 'Unknown' platform revenue before reallocating budget.";
    const rows = Array.from({ length: 10 }).map((_, i) => ({
      ...scoreResult(
        { ...basePrompt, id: `p-${i}`, question: `Q${i}`, intent: "platform_concentration", requires_external: false },
        {
          ...okRun,
          response: {
            ...okRun.response,
            diagnostics: { intent: "platform_concentration" },
            recommendations: [{ action: repeatedAction }, { action: "Set platform ROI thresholds and pause weak channels." }],
            citations: [],
          },
        },
      ),
      quality_score: 8.8,
      pass: true,
    }));
    const penalized = applyRepetitionPenalty(rows);
    expect(penalized.some((row) => row.safety_flags.includes("recommendation_repetition"))).toBe(true);
    expect(penalized.some((row) => row.quality_score < 8.8)).toBe(true);
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
