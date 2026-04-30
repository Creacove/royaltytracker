import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AiInsights from "@/pages/AiInsights";
import type { AiInsightsTurnResponse } from "@/types/insights";

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: supabaseMocks.invoke,
    },
    rpc: supabaseMocks.rpc,
  },
}));

function renderAiInsights(initialPath = "/ai-insights") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AiInsights />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function responseFixture(overrides: Partial<AiInsightsTurnResponse> = {}): AiInsightsTurnResponse {
  return {
    conversation_id: "conv-test",
    resolved_mode: "workspace-general",
    resolved_entities: {},
    answer_title: "AI analyst answer",
    executive_answer:
      "Summer Voltage and Neon Machine need immediate attention for different reasons. Summer Voltage is the strongest upside case at $240,000 in net revenue, while Neon Machine is the intervention case because revenue fell 38% in the latest period.",
    why_this_matters:
      "This is the decision a paid catalog analyst would separate for management: protect the artist already proving demand, but do not keep spending blindly on the declining artist until the team checks territory mix, platform concentration, and metadata leakage. The next move is a split operating plan, not a generic budget increase.",
    evidence: {
      row_count: 7,
      scanned_rows: 21,
      from_date: "2024-01-01",
      to_date: "2026-04-30",
      provenance: ["ai-insights-router-v1"],
      system_confidence: "high",
    },
    actions: [],
    follow_up_questions: [],
    visual: {
      type: "table",
      columns: ["artist_name", "net_revenue"],
      rows: [{ artist_name: "Summer Voltage", net_revenue: 240000 }],
    },
    kpis: [],
    quality_outcome: "pass",
    diagnostics: {
      synthesis_source: "ai_final_writer",
      answer_quality: { status: "passed", reasons: [] },
      evidence_answer_pack: {
        question_intent: {
          objective: "artist_budget_allocation",
          normalized_question: "which artists deserve immediate attention?",
          mode: "workspace-general",
          required_slots: [],
          optional_slots: [],
        },
      },
    } as any,
    evidence_bundle: {
      evidence_answer_pack: {
        question_intent: {
          objective: "artist_budget_allocation",
          normalized_question: "which artists deserve immediate attention?",
          mode: "workspace-general",
          required_slots: [],
          optional_slots: [],
        },
        evidence_slots: [],
        primary_slot_id: "artist_revenue_rank",
        supporting_slot_ids: [],
        caveats: [],
        verified_answer_inputs: {
          primary_job_id: "artist-rank",
          primary_columns: ["artist_name", "net_revenue"],
          primary_rows: [{ artist_name: "Summer Voltage", net_revenue: 240000 }],
        },
        has_usable_evidence: true,
        diagnostics: {
          successful_job_ids: ["artist-rank"],
          failed_job_ids: [],
          empty_job_ids: [],
          selected_primary_job_id: "artist-rank",
        },
      },
      sql_evidence_jobs: [
        {
          job_id: "artist-rank",
          purpose: "workspace artist ranking",
          requirement: "required",
          row_count: 2,
          columns: ["artist_name", "net_revenue"],
          rows: [{ artist_name: "Summer Voltage", net_revenue: 240000 }],
        },
      ],
      structured_sidecar_evidence: null,
    } as any,
    render_hints: {
      layout: "prose_first",
      density: "expanded",
      visual_preference: "table",
      show_confidence_badges: true,
      evidence_visibility: "collapsed",
      visible_artifact_ids: ["fallback-visual"],
      answer_depth: "deep",
    } as any,
    ...overrides,
  };
}

async function ask(question: string) {
  const input = screen.getByPlaceholderText(/ask about leakage/i);
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));
  await screen.findByText(question);
}

describe("AI insights rendered answer flow", () => {
  beforeEach(() => {
    supabaseMocks.invoke.mockReset();
    supabaseMocks.rpc.mockReset();
    supabaseMocks.rpc.mockResolvedValue({
      data: [
        {
          track_key: "track:midnight",
          track_title: "Midnight Signal",
          artist_name: "Zara Hughes",
          artist_key: "artist:zara-hughes",
          net_revenue: 120000,
          gross_revenue: 160000,
          quantity: 900000,
        },
      ],
      error: null,
    });
  });

  it("renders a workspace-mode AI-written answer from question submit through UI", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: responseFixture(),
      error: null,
    });

    renderAiInsights();
    await ask("Which artists deserve immediate attention?");

    expect(await screen.findByText(/Summer Voltage and Neon Machine need immediate attention/i)).toBeInTheDocument();
    expect(screen.getByText(/paid catalog analyst/i)).toBeInTheDocument();
    expect(screen.queryByText(/decision-grade next step.*only after/i)).not.toBeInTheDocument();
    expect(supabaseMocks.invoke).toHaveBeenCalledWith("ai-insights-router-v1", {
      body: expect.objectContaining({
        question: "Which artists deserve immediate attention?",
        entity_context: {},
      }),
    });
  });

  it("renders artist-mode strategy with artist-scoped entity context", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: responseFixture({
        resolved_mode: "artist",
        resolved_entities: { artist_key: "artist:zara-hughes", artist_name: "Zara Hughes" },
        answer_title: "Artist touring and platform strategy",
        executive_answer:
          "Zara Hughes should validate touring in GB first, then US, because those are the strongest known territory revenue signals. The strategy is to pair the live test with platform-specific marketing on Spotify and short-form video, not to treat touring as a standalone bet.",
        why_this_matters:
          "For an artist manager, this matters because royalty geography is a proxy for demand, not a venue plan. The premium move is to use GB as the first routing hypothesis, validate city demand and promoter fit, then use the platform mix to decide where marketing spend supports ticket conversion.",
        visual: {
          type: "table",
          columns: ["territory", "net_revenue"],
          rows: [{ territory: "GB", net_revenue: 140000 }],
        },
        evidence_bundle: {
          sql_evidence_jobs: [
            {
              job_id: "territory-context",
              purpose: "artist-scoped territory revenue",
              requirement: "required",
              row_count: 2,
              columns: ["territory", "net_revenue"],
              rows: [{ territory: "GB", net_revenue: 140000 }],
            },
            {
              job_id: "platform-context",
              purpose: "artist-scoped platform revenue",
              requirement: "supporting",
              row_count: 2,
              columns: ["platform", "net_revenue"],
              rows: [{ platform: "Spotify", net_revenue: 90000 }],
            },
          ],
        } as any,
      }),
      error: null,
    });

    renderAiInsights("/ai-insights?artist_key=artist:zara-hughes&artist=Zara%20Hughes");
    await ask("Where should this artiste tour?");

    expect(await screen.findByText(/Zara Hughes should validate touring in GB first/i)).toBeInTheDocument();
    expect(screen.getByText(/royalty geography is a proxy for demand/i)).toBeInTheDocument();
    expect(supabaseMocks.invoke).toHaveBeenCalledWith("ai-insights-router-v1", {
      body: expect.objectContaining({
        question: "Where should this artiste tour?",
        entity_context: expect.objectContaining({
          artist_key: "artist:zara-hughes",
          artist_name: "Zara Hughes",
        }),
      }),
    });
  });

  it("renders track-mode answer with track-scoped strategy only", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: responseFixture({
        resolved_mode: "track",
        resolved_entities: { track_key: "track:midnight", track_title: "Midnight Signal", artist_name: "Zara Hughes" },
        answer_title: "Track growth plan",
        executive_answer:
          "Midnight Signal is currently carried by Spotify in GB, so the next move is a track-specific conversion plan: protect Spotify momentum, test GB creator content, and avoid spreading budget across the whole artist catalog.",
        why_this_matters:
          "This matters because track mode should answer what to do for this recording only. The evidence points to one platform-market combination, so the business decision is a focused experiment for Midnight Signal, not a workspace or artist-wide campaign.",
        visual: {
          type: "table",
          columns: ["platform", "territory", "net_revenue"],
          rows: [{ platform: "Spotify", territory: "GB", net_revenue: 9000 }],
        },
      }),
      error: null,
    });

    renderAiInsights("/ai-insights?track_key=track:midnight");
    await ask("What should we do next for this track?");

    expect(await screen.findByText(/Midnight Signal is currently carried by Spotify in GB/i)).toBeInTheDocument();
    expect(screen.getByText(/this recording only/i)).toBeInTheDocument();
    expect(screen.queryByText(/whole artist catalog/i)).toBeInTheDocument();
    expect(supabaseMocks.invoke).toHaveBeenCalledWith("ai-insights-router-v1", {
      body: expect.objectContaining({
        question: "What should we do next for this track?",
        entity_context: expect.objectContaining({
          track_key: "track:midnight",
        }),
      }),
    });
  });
});
