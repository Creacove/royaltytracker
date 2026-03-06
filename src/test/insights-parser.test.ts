import { describe, expect, it } from "vitest";
import { parseAssistantExportResponseV1, parseAssistantTurnResponseV2 } from "@/lib/insights";

describe("insights assistant parser v2", () => {
  it("parses assistant turn response", () => {
    const parsed = parseAssistantTurnResponseV2({
      conversation_id: "conv-1",
      answer_title: "Decision View Ready",
      answer_text: "Revenue increased in the US territory.",
      why_this_matters: "Prioritize US follow-up this week.",
      kpis: [{ label: "Net Revenue", value: "$1,000" }],
      table: {
        columns: ["territory", "net_revenue"],
        rows: [{ territory: "US", net_revenue: 1000 }],
      },
      chart: {
        type: "bar",
        x: "territory",
        y: ["net_revenue"],
      },
      evidence: {
        row_count: 12,
        duration_ms: 55,
        from_date: "2026-01-01",
        to_date: "2026-01-31",
        provenance: ["track_assistant_scope_v2"],
      },
      follow_up_questions: ["Break this down by platform."],
      diagnostics: {
        intent: "top_revenue_track",
        confidence: "high",
        used_fields: ["track_title", "net_revenue"],
        missing_fields: [],
        strict_mode: true,
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.conversation_id).toBe("conv-1");
    expect(parsed?.kpis[0].label).toBe("Net Revenue");
    expect(parsed?.table?.rows[0].territory).toBe("US");
    expect(parsed?.diagnostics?.intent).toBe("top_revenue_track");
  });

  it("parses export response", () => {
    const parsed = parseAssistantExportResponseV1({
      pdf_url: "https://example.com/a.pdf",
      xlsx_url: "https://example.com/a.xlsx",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.pdf_url).toContain(".pdf");
    expect(parsed?.xlsx_url).toContain(".xlsx");
  });
});
