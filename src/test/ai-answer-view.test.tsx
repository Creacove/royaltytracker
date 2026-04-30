import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AiInsightsTurnResponse } from "@/types/insights";
import { AiAnswerView } from "@/components/insights/AiAnswerView";

function samplePayload(overrides: Partial<AiInsightsTurnResponse> = {}): AiInsightsTurnResponse {
  return {
    conversation_id: "conv_1",
    resolved_mode: "workspace-general",
    resolved_entities: {},
    answer_title: "Catalog shift",
    executive_answer:
      "Revenue accelerated in Germany and Spotify remains the strongest platform, but unresolved payout blockers are still suppressing clean visibility.",
    why_this_matters:
      "The current mix supports reallocating attention toward Germany while cleaning failed rows before they distort the next planning cycle.",
    evidence: {
      row_count: 12,
      scanned_rows: 24,
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      provenance: ["assistant_workspace_overview_v1"],
      system_confidence: "high",
    },
    actions: [{ label: "Open transactions", href: "/transactions", kind: "primary" }],
    follow_up_questions: ["Which territories should we prioritise next?"],
    visual: {
      type: "line",
      title: "Revenue trend",
      x: "month_start",
      y: ["net_revenue"],
      rows: [
        { month_start: "2026-01-01", net_revenue: 1200 },
        { month_start: "2026-02-01", net_revenue: 1800 },
      ],
    },
    kpis: [{ label: "Net revenue", value: "$1,800" }],
    recommended_actions: [
      {
        title: "Lean into Germany",
        rationale: "It is driving the strongest recent lift.",
      },
    ],
    citations: [
      {
        title: "Workspace overview",
        source_type: "workspace_data",
      },
    ],
    render_hints: {
      layout: "prose_first",
      density: "expanded",
      visual_preference: "chart",
      show_confidence_badges: true,
      evidence_visibility: "collapsed",
      visible_artifact_ids: ["fallback-visual", "fallback-recommendations"],
    } as any,
    ...overrides,
  };
}

describe("AiAnswerView", () => {
  it("renders a prose-first answer and keeps evidence collapsed by default", () => {
    render(<AiAnswerView payload={samplePayload()} onUseQuestion={vi.fn()} />);

    expect(screen.getByText(/Revenue accelerated in Germany/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show evidence/i })).toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("reveals citations and evidence details when opened", () => {
    render(<AiAnswerView payload={samplePayload()} onUseQuestion={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /show evidence/i }));

    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Workspace overview")).toBeInTheDocument();
  });

  it("shows only the selected support artifacts in the default view", () => {
    render(<AiAnswerView payload={samplePayload()} onUseQuestion={vi.fn()} />);

    expect(screen.getByText("Revenue trend")).toBeInTheDocument();
    expect(screen.getByText("Recommendations")).toBeInTheDocument();
    expect(screen.queryByText("Evidence Table")).not.toBeInTheDocument();
  });

  it("keeps answer sections out of the main view and groups evidence rows by job", () => {
    render(
      <AiAnswerView
        payload={samplePayload({
          answer_sections: [
            {
              id: "drivers",
              title: "Drivers",
              content: "Spotify explains most of the lift, while Germany is the strongest territory.",
              evidence_job_ids: ["platform-context", "territory-context"],
              status: "supported",
            },
            {
              id: "next_move",
              title: "Next move",
              content: "Move campaign budget toward Germany and audit failed rows before payout planning.",
              evidence_job_ids: ["primary"],
              status: "supported",
            },
          ],
          evidence_bundle: {
            sql_evidence_jobs: [
              {
                job_id: "platform-context",
                purpose: "Platform drivers",
                requirement: "supporting",
                row_count: 2,
                columns: ["platform", "net_revenue"],
                rows: [{ platform: "Spotify", net_revenue: 1800 }],
              },
              {
                job_id: "territory-context",
                purpose: "Territory drivers",
                requirement: "supporting",
                row_count: 2,
                columns: ["territory", "net_revenue"],
                rows: [{ territory: "Germany", net_revenue: 1200 }],
              },
            ],
          },
        })}
        onUseQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText(/Revenue accelerated in Germany/)).toBeInTheDocument();
    expect(screen.queryByText("Drivers")).not.toBeInTheDocument();
    expect(screen.queryByText("Next move")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show evidence/i }));

    expect(screen.getByText("Platform drivers")).toBeInTheDocument();
    expect(screen.getByText("Territory drivers")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    expect(screen.getByText("Germany")).toBeInTheDocument();
  });

  it("shows a copyable debug drawer with SQL job errors and diagnostics", () => {
    const writeText = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <AiAnswerView
        payload={samplePayload({
          evidence_bundle: {
            sql_evidence_jobs: [
              {
                job_id: "primary",
                purpose: "answer the main revenue question",
                requirement: "required",
                row_count: 0,
                columns: [],
                rows: [],
                verifier_status: "failed",
                error: "SQL execution failed: column r.source_kind does not exist",
                warnings: ["Generated SQL referenced a missing catalog column."],
              },
            ],
          },
          job_diagnostics: [
            {
              job_id: "primary",
              type: "sql",
              status: "failed",
              row_count: 0,
              error: "SQL execution failed: column r.source_kind does not exist",
              warnings: ["Generated SQL referenced a missing catalog column."],
            },
          ],
          diagnostics: {
            intent: "revenue_analysis",
            confidence: "low",
            used_fields: ["net_revenue"],
            missing_fields: ["source_kind"],
            strict_mode: false,
            sql_evidence_jobs: [{ job_id: "primary", error: "SQL execution failed" }],
          } as any,
        })}
        onUseQuestion={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /debug/i })).toBeInTheDocument();
    expect(screen.queryByText(/column r.source_kind does not exist/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /debug/i }));

    expect(screen.getByText("SQL / Answer Debug")).toBeInTheDocument();
    expect(screen.getAllByText(/column r.source_kind does not exist/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("primary").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /copy debug json/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("source_kind"));
  });
});
