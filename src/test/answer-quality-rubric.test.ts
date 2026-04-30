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

  it("fails generic consultant filler in why-this-matters even when it is long", () => {
    const result = evaluateAnswerQuality({
      question: "Where is revenue leaking the most right now?",
      mode: "workspace-general",
      answer: {
        executive_answer:
          "The workspace has $525.28 million in gross revenue and $516.56 million in net revenue, creating an $8.72 million gross-to-net gap that should be reviewed by platform and artist.",
        why_this_matters:
          "Understanding where revenue is leaking is essential for strategic financial management. The leakage can have significant implications for cash flow and profitability. Identifying the sources of this leakage can lead to targeted interventions that enhance overall revenue performance. Addressing these leaks can improve investor confidence and support future growth initiatives. A strategic focus on optimizing revenue channels can enhance competitive positioning in the market.",
      },
      evidenceSlots: [
        {
          slot_id: "artist_leakage_rank",
          status: "passed",
          columns: ["artist_name", "gross_revenue", "net_revenue", "revenue_gap"],
          row_count: 5,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "generic_why_this_matters",
      "why_this_matters_missing_next_action",
    ]));
  });

  it("fails why-this-matters that repeats the executive answer instead of adding analyst judgment", () => {
    const executive =
      "Zara Hughes should validate touring in GB first because GB is the strongest territory by net revenue, then use US as the second market after city-level demand checks.";
    const result = evaluateAnswerQuality({
      question: "Where should this artiste tour right now?",
      mode: "artist",
      answer: {
        executive_answer: executive,
        why_this_matters: `${executive} ${executive}`,
      },
      evidenceSlots: [
        {
          slot_id: "territory_revenue_rank",
          status: "passed",
          columns: ["territory", "net_revenue", "platform"],
          row_count: 4,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.reasons).toContain("why_this_matters_repeats_executive");
  });

  it("fails unknown or n/a targets for touring recommendations", () => {
    const result = evaluateAnswerQuality({
      question: "Where should this artiste tour right now?",
      mode: "artist",
      answer: {
        executive_answer:
          "Touring priority should start with United Kingdom (GB), with n/a as the secondary test market because both appear in the revenue result.",
        why_this_matters:
          "The next move is to validate venue demand in GB while treating n/a as a controlled expansion market, then measure ticket velocity before widening the routing plan.",
      },
      evidenceSlots: [
        {
          slot_id: "territory_revenue_rank",
          status: "passed",
          columns: ["territory", "net_revenue"],
          row_count: 5,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.reasons).toContain("unknown_or_null_target_recommended");
  });
});
