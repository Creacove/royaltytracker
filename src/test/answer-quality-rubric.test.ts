import { describe, expect, it } from "vitest";

import {
  evaluateAnswerQuality,
} from "../../supabase/functions/_shared/assistant-answer-quality";

describe("answer quality rubric", () => {
  it("passes a strategic AI-written answer with evidence-backed why-this-matters", () => {
    const result = evaluateAnswerQuality({
      question: "Which artists deserve immediate attention?",
      mode: "workspace-general",
      answer: {
        executive_answer:
          "Summer Voltage deserves the first operating review because it has the largest recoverable revenue signal at $240,000, while Neon Machine has the sharpest recent decline at -38% quarter over quarter. Treat Summer Voltage as the upside case and Neon Machine as the intervention case.",
        why_this_matters:
          "This matters because the label should not treat every high-revenue artist the same. Summer Voltage needs budget protection and a campaign plan around its strongest territories, while Neon Machine needs a leakage and demand review before more spend is committed. That split gives management two different actions: scale the proven earner and diagnose the declining asset.",
      },
      evidenceSlots: [
        {
          slot_id: "artist_revenue_rank",
          status: "passed",
          columns: ["artist_name", "net_revenue", "growth_pct"],
          row_count: 2,
        },
      ],
    });

    expect(result.status).toBe("passed");
    expect(result.reasons).not.toContain("thin_why_this_matters");
  });

  it("fails one-line deterministic copy that ignores available artist evidence", () => {
    const result = evaluateAnswerQuality({
      question: "Which artists deserve immediate attention?",
      mode: "workspace-general",
      answer: {
        executive_answer:
          "I can give a decision-grade next step for the workspace only after the result shows the main revenue driver in a ranked dimension.",
        why_this_matters:
          "A useful recommendation has to be anchored to the thing actually carrying the result.",
      },
      evidenceSlots: [
        {
          slot_id: "artist_revenue_rank",
          status: "passed",
          columns: ["artist_name", "net_revenue"],
          row_count: 5,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "claims_missing_evidence_despite_passed_required_slot",
      "thin_why_this_matters",
    ]));
  });
});
