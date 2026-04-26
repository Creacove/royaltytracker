import { describe, expect, it } from "vitest";

import {
  designAssistantAnswer,
  inferAssistantCapabilities,
} from "../../supabase/functions/_shared/assistant-answer-design";

describe("assistant answer design", () => {
  it("selects multiple capabilities for mixed music-business questions", () => {
    const capabilities = inferAssistantCapabilities(
      "What is this writer getting from this song, where are we losing money, and what should we do next?",
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        "entitlement_estimation",
        "rights_and_ownership",
        "financial_performance",
        "data_quality_and_conflicts",
        "operating_recommendations",
      ]),
    );
  });

  it("designs a deep answer with only the most useful supporting artifacts", () => {
    const design = designAssistantAnswer({
      question:
        "What changed across this catalog this quarter, why does it matter, and what should we do next?",
      evidence: {
        row_count: 248,
        scanned_rows: 248,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_workspace_overview_v1"],
        system_confidence: "high",
      },
      visual: {
        type: "line",
        title: "Quarterly revenue trend",
        x: "month_start",
        y: ["net_revenue"],
        rows: [
          { month_start: "2026-01-01", net_revenue: 1200 },
          { month_start: "2026-02-01", net_revenue: 1800 },
        ],
      },
      recommendations: [
        { action: "Prioritize Germany", rationale: "Growth is concentrated there." },
        { action: "Resolve payout blockers", rationale: "Failed rows are suppressing visibility." },
      ],
      citations: [
        { title: "Workspace income scope", source_type: "workspace_data" },
        { title: "Market context", source_type: "external" },
      ],
    });

    expect(design.depth).toBe("deep");
    expect(design.evidence_visibility).toBe("collapsed");
    expect(design.artifacts).toHaveLength(2);
    expect(design.artifacts).toEqual([
      expect.objectContaining({ kind: "line_chart", placement: "support" }),
      expect.objectContaining({ kind: "recommendations", placement: "support" }),
    ]);
    expect(design.capabilities).toContain("executive_summary");
  });

  it("keeps simple ownership questions prose-first without unnecessary support artifacts", () => {
    const design = designAssistantAnswer({
      question: "Who owns this work?",
      evidence: {
        row_count: 1,
        scanned_rows: 1,
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        provenance: ["assistant_rights_scope_v1"],
        system_confidence: "high",
      },
      visual: {
        type: "table",
        title: "Ownership table",
        columns: ["party_name", "share_pct"],
        rows: [{ party_name: "Nexus Music Publishing", share_pct: 25 }],
      },
      citations: [{ title: "Rights scope", source_type: "workspace_data" }],
    });

    expect(design.depth).toBe("standard");
    expect(design.artifacts).toEqual([]);
    expect(design.capabilities).toEqual(
      expect.arrayContaining(["rights_and_ownership", "catalog_relationships"]),
    );
  });

  it("keeps broad executive questions multi-capability instead of collapsing into one lane", () => {
    const capabilities = inferAssistantCapabilities(
      "What should marketing, finance, and management focus on next quarter based on revenue trends, territory shifts, and rights conflicts?",
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        "financial_performance",
        "rights_and_ownership",
        "data_quality_and_conflicts",
        "market_and_platform_context",
        "operating_recommendations",
        "executive_summary",
      ]),
    );
  });
});
