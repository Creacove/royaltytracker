import { describe, expect, it } from "vitest";

import {
  buildDecisionGradeAnswer,
  inferAnswerObjective,
} from "../../supabase/functions/_shared/assistant-answer-policy";

describe("assistant answer policy", () => {
  it("locks artist overall answers to the selected subject and internal evidence", () => {
    const result = buildDecisionGradeAnswer({
      question: "How is this artist performing overall across the selected period?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      assistantAnswer:
        "The Kid LAROI has generated a gross revenue of $3,325,297.11 during the selected period. His Coachella appearance and Crocs collaboration reignited engagement.",
      visual: {
        type: "table",
        columns: ["track_title", "net_revenue"],
        rows: [
          { track_title: "Marble Gravity", net_revenue: 3018157.38 },
          { track_title: "Lucky Garden", net_revenue: 2703479.14 },
          { track_title: "Neon Anthem", net_revenue: 174320.76 },
        ],
      },
      kpis: [{ label: "Gross revenue", value: "$3,325,297.11" }],
      evidence: {
        row_count: 3,
        scanned_rows: 3,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "high",
      },
    });

    expect(result.objective).toBe("overall_performance");
    expect(result.executive_answer).toContain("Miles Monroe");
    expect(result.executive_answer).not.toContain("The Kid LAROI");
    expect(result.executive_answer).not.toMatch(/coachella|crocs/i);
    expect(result.why_this_matters).toMatch(/driver|concentrat|decision/i);
    expect(result.external_context_allowed).toBe(false);
  });

  it("refuses to answer a territory question from platform-only evidence and explains what the data does support", () => {
    const result = buildDecisionGradeAnswer({
      question: "Which territories are most important for this artist?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["platform", "net_revenue"],
        rows: [
          { platform: "Social", net_revenue: 3018157.38 },
          { platform: "Radio", net_revenue: 2703479.14 },
        ],
      },
      evidence: {
        row_count: 2,
        scanned_rows: 2,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "medium",
      },
    });

    expect(result.objective).toBe("territory_ranking");
    expect(result.quality_outcome).toBe("constrained");
    expect(result.executive_answer).toMatch(/can't rank territories|cannot rank territories/i);
    expect(result.executive_answer).toMatch(/social|radio/i);
    expect(result.why_this_matters).toMatch(/territory split|market|tour/i);
  });

  it("will not call something a trend without a usable time axis", () => {
    const result = buildDecisionGradeAnswer({
      question: "What is the trend for this artist over time?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["month_label", "net_revenue"],
        rows: [{ month_label: "February 2019", net_revenue: 6680.5 }],
      },
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2019-02-01",
        to_date: "2019-02-28",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "medium",
      },
    });

    expect(result.objective).toBe("trend");
    expect(result.quality_outcome).toBe("constrained");
    expect(result.executive_answer).toMatch(/can't call (this )?a trend|cannot call (this )?a trend/i);
    expect(result.executive_answer).toContain("February 2019");
    expect(result.why_this_matters).toMatch(/time axis|multiple periods|period/i);
  });

  it("turns strategy questions into evidence-backed management advice instead of generic growth hacks", () => {
    const result = buildDecisionGradeAnswer({
      question: "If I were the manager for this artist, what should I do next?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["track_title", "net_revenue"],
        rows: [
          { track_title: "Marble Gravity", net_revenue: 3051772.52 },
          { track_title: "Lucky Garden", net_revenue: 190240.11 },
        ],
      },
      evidence: {
        row_count: 2,
        scanned_rows: 2,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "high",
      },
    });

    expect(result.objective).toBe("recommendation");
    expect(result.executive_answer).toContain("Marble Gravity");
    expect(result.executive_answer).toMatch(/next move|should|focus/i);
    expect(result.executive_answer).not.toMatch(/tiktok|playlist|crocs|coachella/i);
    expect(result.why_this_matters).toMatch(/concentration|driver|secondary/i);
  });

  it("keeps workspace-level overall answers anchored to the workspace rather than drifting to an entity", () => {
    const result = buildDecisionGradeAnswer({
      question: "How are we performing overall?",
      mode: "workspace-general",
      resolvedEntities: {},
      visual: {
        type: "table",
        columns: ["artist_name", "net_revenue"],
        rows: [
          { artist_name: "Miles Monroe", net_revenue: 900000 },
          { artist_name: "Nexus House", net_revenue: 420000 },
        ],
      },
      kpis: [{ label: "Net revenue", value: "$1,320,000.00" }],
      evidence: {
        row_count: 2,
        scanned_rows: 2,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_workspace_overview_v1"],
        system_confidence: "high",
      },
    });

    expect(result.objective).toBe("overall_performance");
    expect(result.executive_answer).toContain("the workspace");
    expect(result.executive_answer).toContain("$1,320,000.00");
    expect(result.why_this_matters).toMatch(/driver|decision/i);
  });

  it("answers platform questions from platform evidence instead of collapsing into a generic summary", () => {
    const result = buildDecisionGradeAnswer({
      question: "Which platforms are strongest for this artist, and which are weak?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["platform", "net_revenue"],
        rows: [
          { platform: "Spotify", net_revenue: 510000 },
          { platform: "YouTube", net_revenue: 190000 },
          { platform: "Radio", net_revenue: 80000 },
        ],
      },
      evidence: {
        row_count: 3,
        scanned_rows: 3,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "high",
      },
    });

    expect(result.objective).toBe("platform_ranking");
    expect(result.executive_answer).toMatch(/Spotify/);
    expect(result.executive_answer).toMatch(/YouTube/);
    expect(result.why_this_matters).toMatch(/channel|platform|dsp/i);
  });

  it("turns quality questions into blocker answers instead of generic filler", () => {
    const result = buildDecisionGradeAnswer({
      question: "What data quality problems are affecting confidence for this artist?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["failed_line_count", "open_critical_task_count"],
        rows: [{ failed_line_count: 42, open_critical_task_count: 7 }],
      },
      diagnostics: {
        missing_fields: ["territory", "rights_type"],
      },
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_quality_scope_v1"],
        system_confidence: "medium",
      },
    });

    expect(result.objective).toBe("quality");
    expect(result.executive_answer).toMatch(/42 failed lines/i);
    expect(result.executive_answer).toMatch(/7 open critical/i);
    expect(result.executive_answer).toMatch(/territory|rights_type/i);
    expect(result.why_this_matters).toMatch(/confidence|leakage|trust/i);
  });

  it("answers touring questions as a revenue-proxy shortlist with an explicit touring caveat", () => {
    const result = buildDecisionGradeAnswer({
      question: "Where should this artist tour next quarter?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["territory", "gross_revenue", "net_revenue", "quantity"],
        rows: [
          { territory: "US", gross_revenue: 946000, net_revenue: 900000, quantity: 1000000 },
          { territory: "GB", gross_revenue: 220000, net_revenue: 180000, quantity: 200000 },
          { territory: "CA", gross_revenue: 120000, net_revenue: 100000, quantity: 120000 },
        ],
      },
      evidence: {
        row_count: 3,
        scanned_rows: 3,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["run_artist_chat_sql_v1"],
        system_confidence: "medium",
      },
    });

    expect(result.objective).toBe("touring");
    expect(result.executive_answer).toMatch(/United States|US/);
    expect(result.executive_answer).toMatch(/United Kingdom|GB/);
    expect(result.why_this_matters).toMatch(/proxy|city|ticket|venue|promoter/i);
  });

  it("answers ownership questions from rights rows without forcing extra sections", () => {
    const result = buildDecisionGradeAnswer({
      question: "Who owns this work?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["party_name", "share_pct", "basis_type"],
        rows: [
          { party_name: "Nexus Music Publishing", share_pct: 25, basis_type: "registered" },
          { party_name: "Miles Monroe", share_pct: 75, basis_type: "registered" },
        ],
      },
      evidence: {
        row_count: 2,
        scanned_rows: 2,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_rights_scope_v1"],
        system_confidence: "high",
      },
    });

    expect(result.objective).toBe("ownership");
    expect(result.executive_answer).toContain("Nexus Music Publishing");
    expect(result.executive_answer).toContain("25%");
    expect(result.why_this_matters).toMatch(/registered|split|contractual/i);
  });

  it("does not hallucinate exact payout when contract terms are missing", () => {
    const result = buildDecisionGradeAnswer({
      question: "What is this writer getting from this song?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
      visual: {
        type: "table",
        columns: ["party_name", "share_pct", "basis_type", "net_revenue"],
        rows: [{ party_name: "Miles Monroe", share_pct: 50, basis_type: "registered", net_revenue: 120000 }],
      },
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_entitlement_scope_v1"],
        system_confidence: "medium",
      },
    });

    expect(result.objective).toBe("entitlement");
    expect(result.quality_outcome).toBe("constrained");
    expect(result.executive_answer).toMatch(/can't give (an )?exact|cannot give (an )?exact/i);
    expect(result.executive_answer).toMatch(/contract/i);
    expect(result.why_this_matters).toMatch(/registered|observed|exact payout/i);
  });

  it("only allows external context when the user explicitly asks for external or benchmark context", () => {
    const internal = buildDecisionGradeAnswer({
      question: "How are we performing overall?",
      mode: "workspace-general",
      resolvedEntities: {},
      visual: { type: "table", columns: ["track_title", "net_revenue"], rows: [{ track_title: "A", net_revenue: 10 }] },
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_workspace_overview_v1"],
        system_confidence: "high",
      },
    });
    const benchmark = buildDecisionGradeAnswer({
      question: "How are we performing overall versus the market, and what external context matters?",
      mode: "workspace-general",
      resolvedEntities: {},
      visual: { type: "table", columns: ["track_title", "net_revenue"], rows: [{ track_title: "A", net_revenue: 10 }] },
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_workspace_overview_v1"],
        system_confidence: "high",
      },
    });

    expect(internal.external_context_allowed).toBe(false);
    expect(benchmark.external_context_allowed).toBe(true);
  });

  it("classifies the core question pack into stable answer objectives", () => {
    expect(inferAnswerObjective("How is this artist performing overall across the selected period?")).toBe("overall_performance");
    expect(inferAnswerObjective("Which tracks are carrying this artist's revenue?")).toBe("track_ranking");
    expect(inferAnswerObjective("Which territories are most important for this artist?")).toBe("territory_ranking");
    expect(inferAnswerObjective("What is the trend for this artist over time?")).toBe("trend");
    expect(inferAnswerObjective("If I were the manager for this artist, what should I do next?")).toBe("recommendation");
    expect(inferAnswerObjective("Where should this artist tour next quarter?")).toBe("touring");
  });
});
