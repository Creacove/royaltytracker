# Answer Excellence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shallow shared answer synthesis path with a deterministic, testable Answer Excellence Engine that produces decision-grade assistant answers for track, artist, and workspace questions while keeping the existing runtime and UI contracts stable.

**Architecture:** Add a shared `answer-excellence` module family under `supabase/functions/_shared/`, keep SQL planning/execution in `assistant-runtime.ts`, and move business reasoning, optional web enrichment, hidden insight generation, action planning, and adaptive presentation into the shared engine. The runtime will call the engine after verification and return its output in the existing assistant-chat payload shape with additive metadata, while `ai-insights-router-v1` becomes a thin passthrough for runtime-backed answers.

**Tech Stack:** TypeScript, Deno edge functions, Supabase RPC wrappers, Vitest, existing assistant payload / `AiInsightsTurnResponse` contracts, OpenAI chat JSON synthesis, OpenAI Responses API web search.

---

### Task 1: Add Core Contracts, Decision Intent, and Evidence Gathering

**Files:**
- Create: `supabase/functions/_shared/answer-excellence/types.ts`
- Create: `supabase/functions/_shared/answer-excellence/infer-decision-intent.ts`
- Create: `supabase/functions/_shared/answer-excellence/gather-relevant-evidence.ts`
- Test: `src/test/answer-excellence-intent.test.ts`
- Test: `src/test/answer-excellence-evidence.test.ts`

- [ ] **Step 1: Write the failing intent and evidence tests**

```ts
// src/test/answer-excellence-intent.test.ts
import { describe, expect, it } from "vitest";

import { inferDecisionIntent } from "../../supabase/functions/_shared/answer-excellence/infer-decision-intent";

describe("inferDecisionIntent", () => {
  it("maps touring questions to profitable routing decisions", () => {
    const result = inferDecisionIntent({
      question: "Where should this artist tour next quarter?",
      mode: "artist",
      resolvedEntities: { artist_name: "Miles Monroe" },
    });

    expect(result).toMatchObject({
      intent: "touring",
      real_decision: "prioritize profitable routing and market validation",
      urgency_level: "planning_cycle",
      departments_impacted: expect.arrayContaining(["touring", "finance", "marketing"]),
      web_enrichment_policy: "conditional",
    });
    expect(result.allowed_lenses).toEqual(
      expect.arrayContaining(["finance", "growth", "market_timing", "operations", "risk"]),
    );
  });

  it("maps revenue decline questions to anomaly diagnosis", () => {
    const result = inferDecisionIntent({
      question: "Why is revenue down this quarter and what should we do next?",
      mode: "workspace-general",
      resolvedEntities: {},
    });

    expect(result).toMatchObject({
      intent: "revenue_diagnosis",
      real_decision: "diagnose the decline and prioritize corrective actions",
      urgency_level: "immediate",
      departments_impacted: expect.arrayContaining(["finance", "operations", "executive"]),
    });
    expect(result.required_evidence_classes).toEqual(
      expect.arrayContaining(["time_series", "driver_ranking"]),
    );
  });
});
```

```ts
// src/test/answer-excellence-evidence.test.ts
import { describe, expect, it } from "vitest";

import { gatherRelevantEvidence } from "../../supabase/functions/_shared/answer-excellence/gather-relevant-evidence";

describe("gatherRelevantEvidence", () => {
  it("marks territory ranking weak when the result only has platform rows", () => {
    const result = gatherRelevantEvidence({
      decisionIntent: {
        intent: "territory_prioritization",
        real_decision: "rank territories for commercial focus",
        urgency_level: "planning_cycle",
        departments_impacted: ["marketing"],
        question_family: "ranking",
        allowed_lenses: ["finance", "growth"],
        required_evidence_classes: ["territory"],
        web_enrichment_policy: "forbidden",
      },
      evidence: {
        columns: ["platform", "net_revenue"],
        rows: [
          { platform: "Spotify", net_revenue: 510000 },
          { platform: "YouTube", net_revenue: 190000 },
        ],
        rowCount: 2,
        scannedRows: 2,
        provenance: ["run_artist_chat_sql_v1"],
        systemConfidence: "high",
      },
      fromDate: "2026-01-01",
      toDate: "2026-03-31",
    });

    expect(result.fit).toBe("weak");
    expect(result.gaps).toContain("territory");
    expect(result.blockers).toContain("territory_dimension_missing");
  });

  it("computes concentration and trend metrics from verified track rows", () => {
    const result = gatherRelevantEvidence({
      decisionIntent: {
        intent: "revenue_concentration",
        real_decision: "decide which assets deserve priority",
        urgency_level: "planning_cycle",
        departments_impacted: ["finance", "marketing"],
        question_family: "ranking",
        allowed_lenses: ["finance", "growth", "risk"],
        required_evidence_classes: ["track", "money"],
        web_enrichment_policy: "forbidden",
      },
      evidence: {
        columns: ["track_title", "net_revenue", "month_start"],
        rows: [
          { track_title: "Marble Gravity", net_revenue: 900000, month_start: "2026-01-01" },
          { track_title: "Lucky Garden", net_revenue: 210000, month_start: "2026-02-01" },
          { track_title: "Neon Anthem", net_revenue: 80000, month_start: "2026-03-01" },
        ],
        rowCount: 3,
        scannedRows: 3,
        provenance: ["run_artist_chat_sql_v1"],
        systemConfidence: "high",
      },
      fromDate: "2026-01-01",
      toDate: "2026-03-31",
    });

    expect(result.fit).toBe("strong");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "top_driver_share" }),
        expect.objectContaining({ key: "net_revenue_total", value: 1190000 }),
      ]),
    );
    expect(result.rankings[0]).toMatchObject({
      dimension: "track_title",
      topItems: [expect.objectContaining({ label: "Marble Gravity" })],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new modules do not exist yet**

Run: `npm test -- src/test/answer-excellence-intent.test.ts src/test/answer-excellence-evidence.test.ts`

Expected: FAIL with module resolution errors for `answer-excellence/infer-decision-intent` and `answer-excellence/gather-relevant-evidence`.

- [ ] **Step 3: Implement the core types, decision intent inference, and evidence gathering**

```ts
// supabase/functions/_shared/answer-excellence/types.ts
export type ExcellenceMode = "track" | "artist" | "workspace-general";
export type WebEnrichmentPolicy = "forbidden" | "conditional";

export type AnswerExcellenceInput = {
  question: string;
  mode: ExcellenceMode;
  resolvedEntities: {
    track_key?: string;
    track_title?: string;
    artist_key?: string;
    artist_name?: string;
  };
  fromDate: string;
  toDate: string;
  evidence: {
    columns: string[];
    rows: Array<Record<string, string | number | null>>;
    rowCount: number;
    scannedRows: number;
    provenance: string[];
    systemConfidence: "high" | "medium" | "low";
    diagnostics?: Record<string, unknown>;
    selectedColumns?: string[];
    missingColumns?: string[];
  };
  workspaceContext?: {
    catalog?: Record<string, unknown>;
    rights?: Record<string, unknown>;
    contracts?: Record<string, unknown>;
    company?: Record<string, unknown>;
  };
};

export type DecisionIntent = {
  intent: string;
  real_decision: string;
  urgency_level: "immediate" | "planning_cycle" | "exploratory";
  departments_impacted: string[];
  question_family: "ranking" | "diagnosis" | "recommendation" | "comparison" | "general";
  allowed_lenses: Array<
    "finance" |
    "growth" |
    "operations" |
    "market_timing" |
    "risk" |
    "competitive_context" |
    "artist_brand" |
    "long_term_catalog_value"
  >;
  required_evidence_classes: string[];
  web_enrichment_policy: WebEnrichmentPolicy;
};

export type EvidenceMetric = {
  key: string;
  value: number;
  label: string;
  evidenceIds: string[];
};

export type EvidenceRanking = {
  dimension: string;
  metricKey: string;
  topItems: Array<{
    label: string;
    value: number;
    share?: number;
    evidenceIds: string[];
  }>;
};

export type RelevantEvidence = {
  fit: "strong" | "partial" | "weak";
  facts: Array<{
    id: string;
    headline: string;
    supportingColumns: string[];
  }>;
  metrics: EvidenceMetric[];
  rankings: EvidenceRanking[];
  strengths: string[];
  gaps: string[];
  blockers: string[];
};
```

```ts
// supabase/functions/_shared/answer-excellence/infer-decision-intent.ts
import type { DecisionIntent, ExcellenceMode } from "./types.ts";

type InferDecisionIntentArgs = {
  question: string;
  mode: ExcellenceMode;
  resolvedEntities: {
    track_key?: string;
    track_title?: string;
    artist_key?: string;
    artist_name?: string;
  };
};

export function inferDecisionIntent(args: InferDecisionIntentArgs): DecisionIntent {
  const q = args.question.toLowerCase();

  if (/\b(tour|touring|route|routing|book|booking|live show|venue|city)\b/.test(q)) {
    return {
      intent: "touring",
      real_decision: "prioritize profitable routing and market validation",
      urgency_level: "planning_cycle",
      departments_impacted: ["touring", "finance", "marketing"],
      question_family: "recommendation",
      allowed_lenses: ["finance", "growth", "market_timing", "operations", "risk"],
      required_evidence_classes: ["territory", "money", "audience_proxy"],
      web_enrichment_policy: "conditional",
    };
  }

  if (/\b(why is revenue down|revenue down|decline|drop|down this quarter)\b/.test(q)) {
    return {
      intent: "revenue_diagnosis",
      real_decision: "diagnose the decline and prioritize corrective actions",
      urgency_level: "immediate",
      departments_impacted: ["finance", "operations", "executive"],
      question_family: "diagnosis",
      allowed_lenses: ["finance", "operations", "risk"],
      required_evidence_classes: ["time_series", "driver_ranking", "money"],
      web_enrichment_policy: "conditional",
    };
  }

  if (/\b(which tracks|top tracks|carrying.*revenue|driving.*revenue)\b/.test(q)) {
    return {
      intent: "revenue_concentration",
      real_decision: "decide which assets deserve priority",
      urgency_level: "planning_cycle",
      departments_impacted: ["finance", "marketing", "executive"],
      question_family: "ranking",
      allowed_lenses: ["finance", "growth", "risk"],
      required_evidence_classes: ["track", "money"],
      web_enrichment_policy: "forbidden",
    };
  }

  if (/\b(territor|market|country)\b/.test(q)) {
    return {
      intent: "territory_prioritization",
      real_decision: "rank territories for commercial focus",
      urgency_level: "planning_cycle",
      departments_impacted: ["marketing", "finance"],
      question_family: "ranking",
      allowed_lenses: ["finance", "growth", "risk"],
      required_evidence_classes: ["territory", "money"],
      web_enrichment_policy: "conditional",
    };
  }

  return {
    intent: "general_strategy",
    real_decision: "summarize the strongest grounded next move",
    urgency_level: "exploratory",
    departments_impacted: args.mode === "workspace-general" ? ["executive"] : ["finance"],
    question_family: "general",
    allowed_lenses: ["finance", "risk"],
    required_evidence_classes: ["money"],
    web_enrichment_policy: "forbidden",
  };
}
```

```ts
// supabase/functions/_shared/answer-excellence/gather-relevant-evidence.ts
import type { DecisionIntent, RelevantEvidence } from "./types.ts";

type GatherRelevantEvidenceArgs = {
  decisionIntent: DecisionIntent;
  evidence: {
    columns: string[];
    rows: Array<Record<string, string | number | null>>;
    rowCount: number;
    scannedRows: number;
    provenance: string[];
    systemConfidence: "high" | "medium" | "low";
  };
  fromDate: string;
  toDate: string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectMoneyKey(columns: string[]): string | null {
  return ["net_revenue", "gross_revenue", "revenue", "amount"].find((key) => columns.includes(key)) ?? null;
}

function detectRankingDimension(columns: string[]): string | null {
  return ["track_title", "territory", "platform", "artist_name"].find((key) => columns.includes(key)) ?? null;
}

export function gatherRelevantEvidence(args: GatherRelevantEvidenceArgs): RelevantEvidence {
  const { columns, rows } = args.evidence;
  const moneyKey = detectMoneyKey(columns);
  const rankingDimension = detectRankingDimension(columns);
  const blockers: string[] = [];
  const gaps: string[] = [];

  for (const needed of args.decisionIntent.required_evidence_classes) {
    if (needed === "territory" && !columns.includes("territory")) {
      blockers.push("territory_dimension_missing");
      gaps.push("territory");
    }
    if (needed === "track" && !columns.includes("track_title")) {
      blockers.push("track_dimension_missing");
      gaps.push("track_title");
    }
    if (needed === "time_series" && !columns.some((column) => /month|week|day|date|quarter/.test(column))) {
      blockers.push("time_dimension_missing");
      gaps.push("time_series");
    }
  }

  if (!moneyKey) {
    blockers.push("money_metric_missing");
    gaps.push("money");
  }

  if (blockers.length > 0) {
    return {
      fit: "weak",
      facts: [],
      metrics: [],
      rankings: [],
      strengths: [],
      gaps,
      blockers,
    };
  }

  const numericRows = rows
    .map((row, index) => ({ row, index, value: moneyKey ? toNumber(row[moneyKey]) : null }))
    .filter((item): item is { row: Record<string, string | number | null>; index: number; value: number } => item.value !== null);
  const total = numericRows.reduce((sum, item) => sum + item.value, 0);
  const top = numericRows[0];
  const metrics = [{
    key: "net_revenue_total",
    label: "Net revenue total",
    value: total,
    evidenceIds: numericRows.map((item) => `row_${item.index}`),
  }];
  if (top && total > 0) {
    metrics.push({
      key: "top_driver_share",
      label: "Top driver share",
      value: top.value / total,
      evidenceIds: [`row_${top.index}`],
    });
  }

  const rankings = rankingDimension
    ? [{
      dimension: rankingDimension,
      metricKey: moneyKey!,
      topItems: numericRows.slice(0, 3).map((item) => ({
        label: String(item.row[rankingDimension] ?? "unknown"),
        value: item.value,
        share: total > 0 ? item.value / total : undefined,
        evidenceIds: [`row_${item.index}`],
      })),
    }]
    : [];

  return {
    fit: args.evidence.rowCount >= 3 ? "strong" : "partial",
    facts: rankings[0]?.topItems[0]
      ? [{
        id: "top_driver",
        headline: `${rankings[0].topItems[0].label} is the strongest current driver.`,
        supportingColumns: [rankingDimension!, moneyKey!],
      }]
      : [],
    metrics,
    rankings,
    strengths: ["verified_sql_result", `${moneyKey}_available`],
    gaps,
    blockers,
  };
}
```

- [ ] **Step 4: Run the tests to verify the new modules pass**

Run: `npm test -- src/test/answer-excellence-intent.test.ts src/test/answer-excellence-evidence.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the core engine scaffolding**

```bash
git add src/test/answer-excellence-intent.test.ts src/test/answer-excellence-evidence.test.ts supabase/functions/_shared/answer-excellence/types.ts supabase/functions/_shared/answer-excellence/infer-decision-intent.ts supabase/functions/_shared/answer-excellence/gather-relevant-evidence.ts
git commit -m "feat: add answer excellence intent and evidence modules"
```

### Task 2: Implement Multi-Lens Reasoning, Hidden Insights, Action Planning, Presentation, and Quality Gate

**Files:**
- Create: `supabase/functions/_shared/answer-excellence/run-multi-lens-reasoning.ts`
- Create: `supabase/functions/_shared/answer-excellence/generate-hidden-insights.ts`
- Create: `supabase/functions/_shared/answer-excellence/create-action-plan.ts`
- Create: `supabase/functions/_shared/answer-excellence/choose-presentation-format.ts`
- Create: `supabase/functions/_shared/answer-excellence/quality-gate.ts`
- Modify: `supabase/functions/_shared/answer-excellence/types.ts`
- Test: `src/test/answer-excellence-reasoning.test.ts`
- Test: `src/test/answer-excellence-quality.test.ts`

- [ ] **Step 1: Write the failing reasoning and quality tests**

```ts
// src/test/answer-excellence-reasoning.test.ts
import { describe, expect, it } from "vitest";

import { createActionPlan } from "../../supabase/functions/_shared/answer-excellence/create-action-plan";
import { choosePresentationFormat } from "../../supabase/functions/_shared/answer-excellence/choose-presentation-format";
import { generateHiddenInsights } from "../../supabase/functions/_shared/answer-excellence/generate-hidden-insights";
import { runMultiLensReasoning } from "../../supabase/functions/_shared/answer-excellence/run-multi-lens-reasoning";

const decisionIntent = {
  intent: "touring",
  real_decision: "prioritize profitable routing and market validation",
  urgency_level: "planning_cycle" as const,
  departments_impacted: ["touring", "finance", "marketing"],
  question_family: "recommendation" as const,
  allowed_lenses: ["finance", "growth", "market_timing", "operations", "risk"] as const,
  required_evidence_classes: ["territory", "money"],
  web_enrichment_policy: "conditional" as const,
};

const relevantEvidence = {
  fit: "strong" as const,
  facts: [{ id: "top_driver", headline: "US is the strongest current driver.", supportingColumns: ["territory", "net_revenue"] }],
  metrics: [
    { key: "net_revenue_total", label: "Net revenue total", value: 1180000, evidenceIds: ["row_0", "row_1", "row_2"] },
    { key: "top_driver_share", label: "Top driver share", value: 0.72, evidenceIds: ["row_0"] },
  ],
  rankings: [{
    dimension: "territory",
    metricKey: "net_revenue",
    topItems: [
      { label: "US", value: 850000, share: 0.72, evidenceIds: ["row_0"] },
      { label: "GB", value: 210000, share: 0.18, evidenceIds: ["row_1"] },
      { label: "CA", value: 120000, share: 0.10, evidenceIds: ["row_2"] },
    ],
  }],
  strengths: ["verified_sql_result"],
  gaps: [],
  blockers: [],
};

describe("answer excellence reasoning", () => {
  it("creates findings, a hidden insight, and ranked actions for touring decisions", () => {
    const reasoning = runMultiLensReasoning({ decisionIntent, relevantEvidence });
    expect(reasoning.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lens: "finance" }),
        expect.objectContaining({ lens: "risk", headline: expect.stringMatching(/concentration/i) }),
      ]),
    );

    const insights = generateHiddenInsights({ decisionIntent, relevantEvidence, reasoning });
    expect(insights[0].insight).toMatch(/concentration|overdependence/i);

    const actions = createActionPlan({ decisionIntent, relevantEvidence, reasoning, hiddenInsights: insights });
    expect(actions[0]).toMatchObject({
      action: expect.stringMatching(/US/),
      owner: "touring",
    });

    const presentation = choosePresentationFormat({
      decisionIntent,
      relevantEvidence,
      reasoning,
      hiddenInsights: insights,
      actionPlan: actions,
    });
    expect(presentation.format).toBe("ranked_list");
  });
});
```

```ts
// src/test/answer-excellence-quality.test.ts
import { describe, expect, it } from "vitest";

import { qualityGate } from "../../supabase/functions/_shared/answer-excellence/quality-gate";

describe("qualityGate", () => {
  it("constrains exact payout answers when contract terms are missing", () => {
    const result = qualityGate({
      decisionIntent: {
        intent: "entitlement",
        real_decision: "estimate exact payout",
        urgency_level: "planning_cycle",
        departments_impacted: ["publishing", "finance"],
        question_family: "diagnosis",
        allowed_lenses: ["finance", "risk"],
        required_evidence_classes: ["contract_terms", "money"],
        web_enrichment_policy: "forbidden",
      },
      relevantEvidence: {
        fit: "partial",
        facts: [],
        metrics: [],
        rankings: [],
        strengths: ["registered_share_only"],
        gaps: ["contract_terms"],
        blockers: ["contract_terms_missing"],
      },
      reasoning: { activeLenses: ["finance", "risk"], findings: [] },
      hiddenInsights: [],
      actionPlan: [],
      citations: [],
      proposedNarrative: {
        executive_answer: "Miles Monroe is getting $60,000.",
        why_this_matters: "This is the exact amount due.",
      },
    });

    expect(result.outcome).toBe("constrained");
    expect(result.missingRequirements).toContain("contract_terms");
  });

  it("fails shallow outputs that have no hidden insight or next action", () => {
    const result = qualityGate({
      decisionIntent: {
        intent: "revenue_concentration",
        real_decision: "decide which assets deserve priority",
        urgency_level: "planning_cycle",
        departments_impacted: ["finance"],
        question_family: "ranking",
        allowed_lenses: ["finance", "risk"],
        required_evidence_classes: ["track", "money"],
        web_enrichment_policy: "forbidden",
      },
      relevantEvidence: {
        fit: "strong",
        facts: [],
        metrics: [],
        rankings: [],
        strengths: ["verified_sql_result"],
        gaps: [],
        blockers: [],
      },
      reasoning: { activeLenses: ["finance"], findings: [] },
      hiddenInsights: [],
      actionPlan: [],
      citations: [],
      proposedNarrative: {
        executive_answer: "Marble Gravity made the most money.",
        why_this_matters: "It is the biggest track.",
      },
    });

    expect(result.outcome).toBe("constrained");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["missing_hidden_insight", "missing_action_plan"]),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify the new reasoning modules are missing**

Run: `npm test -- src/test/answer-excellence-reasoning.test.ts src/test/answer-excellence-quality.test.ts`

Expected: FAIL with missing module errors for the five new reasoning files.

- [ ] **Step 3: Implement the reasoning, hidden-insight, action-plan, presentation, and quality modules**

```ts
// Add these type extensions to supabase/functions/_shared/answer-excellence/types.ts
export type LensFinding = {
  id: string;
  lens: string;
  headline: string;
  implication: string;
  confidence: "high" | "medium" | "low";
  evidenceIds: string[];
  decisionRelevance: "primary" | "secondary";
};

export type MultiLensReasoning = {
  activeLenses: string[];
  findings: LensFinding[];
};

export type HiddenInsight = {
  id: string;
  insight: string;
  whyItMatters: string;
  evidenceIds: string[];
};

export type ActionPlanItem = {
  id: string;
  action: string;
  whyNow: string;
  owner: string;
  timing: string;
  expectedImpact: string;
  riskIfIgnored: string;
  supportingFindingIds: string[];
};

export type PresentationSelection = {
  format: "memo" | "ranked_list" | "comparison" | "chart" | "table" | "warning_first" | "timeline";
  preferredBlockTypes: string[];
};

export type QualityGateResult = {
  outcome: "pass" | "clarify" | "constrained";
  reasons: string[];
  missingRequirements: string[];
};
```

```ts
// supabase/functions/_shared/answer-excellence/run-multi-lens-reasoning.ts
import type { DecisionIntent, MultiLensReasoning, RelevantEvidence } from "./types.ts";

export function runMultiLensReasoning(args: {
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
}): MultiLensReasoning {
  const findings = [];
  const topDriverShare = args.relevantEvidence.metrics.find((metric) => metric.key === "top_driver_share")?.value ?? 0;
  const topRanking = args.relevantEvidence.rankings[0];
  const leadLabel = topRanking?.topItems[0]?.label ?? "the leading segment";

  if (args.decisionIntent.allowed_lenses.includes("finance")) {
    findings.push({
      id: "finance_lead_driver",
      lens: "finance",
      headline: `${leadLabel} is the strongest current commercial driver.`,
      implication: "Prioritize the leading driver before spreading budget across weaker segments.",
      confidence: args.relevantEvidence.fit === "strong" ? "high" : "medium",
      evidenceIds: topRanking?.topItems[0]?.evidenceIds ?? [],
      decisionRelevance: "primary",
    });
  }

  if (args.decisionIntent.allowed_lenses.includes("risk") && topDriverShare >= 0.6) {
    findings.push({
      id: "risk_concentration",
      lens: "risk",
      headline: `Revenue concentration risk is elevated because ${leadLabel} accounts for ${Math.round(topDriverShare * 100)}% of the visible mix.`,
      implication: "Defend the leader, but stage a second driver so the business is less fragile next quarter.",
      confidence: "high",
      evidenceIds: topRanking?.topItems[0]?.evidenceIds ?? [],
      decisionRelevance: "primary",
    });
  }

  if (args.decisionIntent.allowed_lenses.includes("growth") && topRanking?.topItems[1]) {
    findings.push({
      id: "growth_secondary_market",
      lens: "growth",
      headline: `${topRanking.topItems[1].label} is the clearest secondary upside lane.`,
      implication: "Run one controlled follow-on test there instead of widening across too many markets at once.",
      confidence: "medium",
      evidenceIds: topRanking.topItems[1].evidenceIds,
      decisionRelevance: "secondary",
    });
  }

  if (args.decisionIntent.allowed_lenses.includes("operations")) {
    findings.push({
      id: "operations_validation",
      lens: "operations",
      headline: "The next action should be sequenced as validation first, then spend.",
      implication: "Operational validation reduces the risk of acting on a false positive or incomplete view.",
      confidence: "medium",
      evidenceIds: [],
      decisionRelevance: "secondary",
    });
  }

  return {
    activeLenses: [...args.decisionIntent.allowed_lenses],
    findings,
  };
}
```

```ts
// supabase/functions/_shared/answer-excellence/generate-hidden-insights.ts
import type { DecisionIntent, HiddenInsight, MultiLensReasoning, RelevantEvidence } from "./types.ts";

export function generateHiddenInsights(args: {
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
  reasoning: MultiLensReasoning;
}): HiddenInsight[] {
  const share = args.relevantEvidence.metrics.find((metric) => metric.key === "top_driver_share")?.value ?? 0;
  const topRanking = args.relevantEvidence.rankings[0];
  const leadLabel = topRanking?.topItems[0]?.label ?? "the lead segment";

  if (share >= 0.6) {
    return [{
      id: "hidden_concentration_risk",
      insight: `${leadLabel} is doing too much of the work for this question's scope.`,
      whyItMatters: "That creates fragility: one weak release cycle, platform change, or routing miss can pull down the whole result.",
      evidenceIds: topRanking?.topItems[0]?.evidenceIds ?? [],
    }];
  }

  if (topRanking?.topItems[1]) {
    return [{
      id: "hidden_secondary_upside",
      insight: `${topRanking.topItems[1].label} is a better secondary growth lane than a broad portfolio spread.`,
      whyItMatters: "The fastest path to less concentration risk is to build one credible second driver, not many small bets.",
      evidenceIds: topRanking.topItems[1].evidenceIds,
    }];
  }

  return [];
}
```

```ts
// supabase/functions/_shared/answer-excellence/create-action-plan.ts
import type { ActionPlanItem, DecisionIntent, HiddenInsight, MultiLensReasoning, RelevantEvidence } from "./types.ts";

export function createActionPlan(args: {
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
  reasoning: MultiLensReasoning;
  hiddenInsights: HiddenInsight[];
}): ActionPlanItem[] {
  const topRanking = args.relevantEvidence.rankings[0];
  const lead = topRanking?.topItems[0];
  const second = topRanking?.topItems[1];
  const owner = args.decisionIntent.intent === "touring"
    ? "touring"
    : args.decisionIntent.intent.includes("revenue")
      ? "finance"
      : "marketing";

  const items: ActionPlanItem[] = [];
  if (lead) {
    items.push({
      id: "action_primary_focus",
      action: `Prioritize ${lead.label} first.`,
      whyNow: `${lead.label} is the strongest proven driver in the current evidence.`,
      owner,
      timing: "this_week",
      expectedImpact: "Protect the highest visible upside before widening effort.",
      riskIfIgnored: "Budget or routing decisions may spread too thin across weaker segments.",
      supportingFindingIds: ["finance_lead_driver"],
    });
  }
  if (second) {
    items.push({
      id: "action_secondary_test",
      action: `Run one controlled secondary test in ${second.label}.`,
      whyNow: `${second.label} is the clearest candidate for reducing dependency on the top driver.`,
      owner,
      timing: "this_quarter",
      expectedImpact: "Build a second driver without losing focus on the winner.",
      riskIfIgnored: "Concentration risk stays elevated.",
      supportingFindingIds: ["growth_secondary_market", "risk_concentration"],
    });
  }
  return items;
}
```

```ts
// supabase/functions/_shared/answer-excellence/choose-presentation-format.ts
import type { ActionPlanItem, DecisionIntent, HiddenInsight, MultiLensReasoning, PresentationSelection, RelevantEvidence } from "./types.ts";

export function choosePresentationFormat(args: {
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
  reasoning: MultiLensReasoning;
  hiddenInsights: HiddenInsight[];
  actionPlan: ActionPlanItem[];
}): PresentationSelection {
  if (args.decisionIntent.intent === "touring" || args.decisionIntent.question_family === "ranking") {
    return {
      format: "ranked_list",
      preferredBlockTypes: ["recommendations", "table", "risk_flags", "action_plan"],
    };
  }

  if (args.relevantEvidence.blockers.length > 0 || args.hiddenInsights.length > 0 && args.actionPlan.length === 0) {
    return {
      format: "warning_first",
      preferredBlockTypes: ["risk_flags", "citations"],
    };
  }

  return {
    format: "memo",
    preferredBlockTypes: ["deep_summary", "recommendations", "citations"],
  };
}
```

```ts
// supabase/functions/_shared/answer-excellence/quality-gate.ts
import type { DecisionIntent, HiddenInsight, MultiLensReasoning, QualityGateResult, RelevantEvidence } from "./types.ts";

export function qualityGate(args: {
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
  reasoning: MultiLensReasoning;
  hiddenInsights: HiddenInsight[];
  actionPlan: Array<{ id: string }>;
  citations: Array<Record<string, unknown>>;
  proposedNarrative: { executive_answer: string; why_this_matters: string };
}): QualityGateResult {
  const reasons: string[] = [];
  const missingRequirements = [...args.relevantEvidence.gaps];

  if (args.relevantEvidence.blockers.length > 0) {
    reasons.push(...args.relevantEvidence.blockers);
  }
  if (args.hiddenInsights.length === 0 && args.relevantEvidence.fit === "strong") {
    reasons.push("missing_hidden_insight");
  }
  if (args.actionPlan.length === 0) {
    reasons.push("missing_action_plan");
  }
  if (!/\b(prioriti|focus|defend|shift|validate|fix|run|reallocate|renegotiate)\b/i.test(args.proposedNarrative.executive_answer)) {
    reasons.push("not_decision_oriented");
  }

  return {
    outcome: reasons.length > 0 ? "constrained" : "pass",
    reasons,
    missingRequirements,
  };
}
```

- [ ] **Step 4: Run the reasoning and quality tests**

Run: `npm test -- src/test/answer-excellence-reasoning.test.ts src/test/answer-excellence-quality.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the reasoning layer**

```bash
git add src/test/answer-excellence-reasoning.test.ts src/test/answer-excellence-quality.test.ts supabase/functions/_shared/answer-excellence/types.ts supabase/functions/_shared/answer-excellence/run-multi-lens-reasoning.ts supabase/functions/_shared/answer-excellence/generate-hidden-insights.ts supabase/functions/_shared/answer-excellence/create-action-plan.ts supabase/functions/_shared/answer-excellence/choose-presentation-format.ts supabase/functions/_shared/answer-excellence/quality-gate.ts
git commit -m "feat: add answer excellence reasoning pipeline"
```

### Task 3: Add Smart Web Enrichment Using the Existing Router Search Capability

**Files:**
- Create: `supabase/functions/_shared/answer-excellence/enrich-with-web-if-useful.ts`
- Modify: `supabase/functions/_shared/answer-excellence/types.ts`
- Test: `src/test/answer-excellence-web-enrichment.test.ts`

- [ ] **Step 1: Write the failing web-enrichment tests**

```ts
// src/test/answer-excellence-web-enrichment.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { enrichWithWebIfUseful } from "../../supabase/functions/_shared/answer-excellence/enrich-with-web-if-useful";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enrichWithWebIfUseful", () => {
  it("skips web enrichment when the policy is forbidden or evidence fit is weak", async () => {
    const fetchSpy = vi.fn();
    const result = await enrichWithWebIfUseful({
      question: "Which tracks carry revenue?",
      artistName: "Miles Monroe",
      decisionIntent: {
        intent: "revenue_concentration",
        real_decision: "decide which assets deserve priority",
        urgency_level: "planning_cycle",
        departments_impacted: ["finance"],
        question_family: "ranking",
        allowed_lenses: ["finance", "risk"],
        required_evidence_classes: ["track", "money"],
        web_enrichment_policy: "forbidden",
      },
      relevantEvidence: {
        fit: "weak",
        facts: [],
        metrics: [],
        rankings: [],
        strengths: [],
        gaps: ["track_title"],
        blockers: ["track_dimension_missing"],
      },
      findings: [],
      openAiApiKey: "test-key",
      openAiSearchModel: "gpt-4.1-mini",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(result.used).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the Responses API web search path for materially useful touring context", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: "SUMMARY: Festival congestion in London is higher in July. TAKE: Routing into Manchester first may reduce conflict pressure. ACTION_NOTE: Validate Manchester before widening the UK leg.",
        output: [{
          type: "web_search_call",
          action: {
            sources: [{
              title: "UK festival calendar",
              url: "https://example.com/festivals",
            }],
          },
        }],
      }),
    });

    const result = await enrichWithWebIfUseful({
      question: "Where should this artist tour next quarter?",
      artistName: "Miles Monroe",
      decisionIntent: {
        intent: "touring",
        real_decision: "prioritize profitable routing and market validation",
        urgency_level: "planning_cycle",
        departments_impacted: ["touring", "finance"],
        question_family: "recommendation",
        allowed_lenses: ["finance", "growth", "market_timing", "risk"],
        required_evidence_classes: ["territory", "money"],
        web_enrichment_policy: "conditional",
      },
      relevantEvidence: {
        fit: "strong",
        facts: [],
        metrics: [],
        rankings: [{
          dimension: "territory",
          metricKey: "net_revenue",
          topItems: [{ label: "GB", value: 220000, evidenceIds: ["row_1"] }],
        }],
        strengths: ["verified_sql_result"],
        gaps: [],
        blockers: [],
      },
      findings: [{
        id: "touring_finance",
        lens: "finance",
        headline: "GB is the second strongest market.",
        implication: "It should be validated as a routing candidate.",
        confidence: "high",
        evidenceIds: ["row_1"],
        decisionRelevance: "primary",
      }],
      openAiApiKey: "test-key",
      openAiSearchModel: "gpt-4.1-mini",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.used).toBe(true);
    expect(result.cannot_override_internal_claims).toBe(true);
    expect(result.summary).toMatch(/Festival congestion/i);
    expect(result.citations).toEqual([
      expect.objectContaining({
        title: "UK festival calendar",
        source_type: "external",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify web enrichment does not exist yet**

Run: `npm test -- src/test/answer-excellence-web-enrichment.test.ts`

Expected: FAIL with module resolution errors for `answer-excellence/enrich-with-web-if-useful`.

- [ ] **Step 3: Implement the shared web-enrichment module by moving the current router logic into the engine**

```ts
// Add these type extensions to supabase/functions/_shared/answer-excellence/types.ts
export type WebEnrichmentResult = {
  used: boolean;
  decision_use: string | null;
  summary: string;
  advisory_take?: string;
  recommendation_note?: string;
  citations: Array<Record<string, unknown>>;
  shelf_life: "short";
  cannot_override_internal_claims: true;
};
```

```ts
// supabase/functions/_shared/answer-excellence/enrich-with-web-if-useful.ts
import type { DecisionIntent, RelevantEvidence, WebEnrichmentResult, LensFinding } from "./types.ts";

function parseExternalContextSections(rawText: string): {
  summary: string;
  advisoryTake: string;
  recommendationNote: string;
} {
  const trimmed = rawText.trim();
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const readTagged = (tag: string) => lines.find((line) => line.toUpperCase().startsWith(`${tag}:`))?.slice(tag.length + 1).trim() ?? "";
  const summary = readTagged("SUMMARY");
  const advisoryTake = readTagged("TAKE");
  const recommendationNote = readTagged("ACTION_NOTE");
  if (summary || advisoryTake || recommendationNote) {
    return { summary, advisoryTake, recommendationNote };
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    summary: sentences.slice(0, 2).join(" "),
    advisoryTake: sentences.slice(2, 4).join(" "),
    recommendationNote: sentences.slice(4, 5).join(" "),
  };
}

function buildExternalEnrichmentPrompt(args: {
  question: string;
  artistName: string;
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
}): string {
  const territoryAnchor = args.relevantEvidence.rankings.find((ranking) => ranking.dimension === "territory")?.topItems
    .map((item) => item.label)
    .join(", ");
  const anchorText = territoryAnchor ? `Internal evidence points to these markets: ${territoryAnchor}.` : "";
  return `Use live web search to improve this music-business decision for ${args.artistName}. Question: ${args.question}. ${anchorText} Return exactly three lines and nothing else: SUMMARY: <two concise sentences>. TAKE: <two concise consultant-style sentences>. ACTION_NOTE: <one concise sentence>.`;
}

export async function enrichWithWebIfUseful(args: {
  question: string;
  artistName?: string;
  decisionIntent: DecisionIntent;
  relevantEvidence: RelevantEvidence;
  findings: LensFinding[];
  openAiApiKey: string | null;
  openAiSearchModel: string;
  fetchImpl?: typeof fetch;
}): Promise<WebEnrichmentResult> {
  if (
    args.decisionIntent.web_enrichment_policy === "forbidden" ||
    args.relevantEvidence.fit !== "strong" ||
    !args.openAiApiKey
  ) {
    return {
      used: false,
      decision_use: null,
      summary: "",
      citations: [],
      shelf_life: "short",
      cannot_override_internal_claims: true,
    };
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: args.openAiSearchModel,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      input: buildExternalEnrichmentPrompt({
        question: args.question,
        artistName: args.artistName ?? "this artist",
        decisionIntent: args.decisionIntent,
        relevantEvidence: args.relevantEvidence,
      }),
    }),
  });

  if (!response.ok) {
    return {
      used: false,
      decision_use: null,
      summary: "",
      citations: [],
      shelf_life: "short",
      cannot_override_internal_claims: true,
    };
  }

  const payload = await response.json() as Record<string, unknown>;
  const rawText = typeof payload.output_text === "string" ? payload.output_text : "";
  const parsed = parseExternalContextSections(rawText);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const citations = output.flatMap((item) => {
    const sources = (item as { action?: { sources?: Array<Record<string, unknown>> } })?.action?.sources ?? [];
    return sources.flatMap((source) => typeof source.title === "string"
      ? [{
        title: source.title,
        url: typeof source.url === "string" ? source.url : undefined,
        source_type: "external",
      }]
      : []);
  });

  return {
    used: Boolean(parsed.summary || parsed.advisoryTake || parsed.recommendationNote || citations.length > 0),
    decision_use: args.decisionIntent.intent,
    summary: parsed.summary,
    advisory_take: parsed.advisoryTake || undefined,
    recommendation_note: parsed.recommendationNote || undefined,
    citations,
    shelf_life: "short",
    cannot_override_internal_claims: true,
  };
}
```

- [ ] **Step 4: Run the web-enrichment tests**

Run: `npm test -- src/test/answer-excellence-web-enrichment.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the shared web-enrichment move**

```bash
git add src/test/answer-excellence-web-enrichment.test.ts supabase/functions/_shared/answer-excellence/types.ts supabase/functions/_shared/answer-excellence/enrich-with-web-if-useful.ts
git commit -m "feat: add shared answer excellence web enrichment"
```

### Task 4: Orchestrate the Engine in the Shared Assistant Runtime

**Files:**
- Create: `supabase/functions/_shared/answer-excellence/index.ts`
- Modify: `supabase/functions/_shared/assistant-runtime.ts`
- Test: `src/test/answer-excellence-runtime.test.ts`

- [ ] **Step 1: Write the failing engine orchestration and runtime wiring tests**

```ts
// src/test/answer-excellence-runtime.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAnswerExcellenceEngine } from "../../supabase/functions/_shared/answer-excellence";

const runtimePath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-runtime.ts");

describe("runAnswerExcellenceEngine", () => {
  it("returns decision-grade metadata and assistant-runtime-safe fields", async () => {
    const result = await runAnswerExcellenceEngine({
      input: {
        question: "Where should this artist tour next quarter?",
        mode: "artist",
        resolvedEntities: { artist_name: "Miles Monroe" },
        fromDate: "2026-01-01",
        toDate: "2026-03-31",
        evidence: {
          columns: ["territory", "net_revenue", "quantity"],
          rows: [
            { territory: "US", net_revenue: 850000, quantity: 920000 },
            { territory: "GB", net_revenue: 210000, quantity: 240000 },
            { territory: "CA", net_revenue: 120000, quantity: 125000 },
          ],
          rowCount: 3,
          scannedRows: 3,
          provenance: ["run_artist_chat_sql_v1"],
          systemConfidence: "high",
        },
      },
      llm: {
        completeJson: async () => ({
          answer_title: "Touring priorities",
          answer_text: "Prioritize the US first, then validate GB as the secondary market.",
          why_this_matters: "The current mix is concentrated enough that one clear primary route and one controlled secondary test is the fastest path to action.",
          follow_up_questions: ["Which cities should we validate first?"],
        }),
      },
      webSearch: async () => ({
        used: false,
        decision_use: null,
        summary: "",
        citations: [],
        shelf_life: "short",
        cannot_override_internal_claims: true,
      }),
    });

    expect(result.runtimeResponse).toMatchObject({
      answer_title: "Touring priorities",
      quality_outcome: "pass",
      recommendations: [
        expect.objectContaining({ action: expect.stringMatching(/US/) }),
      ],
      answer_design: expect.objectContaining({ depth: "deep" }),
    });
    expect(result.runtimeResponse.answer_blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "recommendations" }),
        expect.objectContaining({ type: "risk_flags" }),
      ]),
    );
  });

  it("wires assistant-runtime through the shared engine", () => {
    const source = readFileSync(runtimePath, "utf8");
    expect(source).toContain("runAnswerExcellenceEngine(");
    expect(source).not.toContain("function evaluateQualityOutcome");
    expect(source).not.toContain("function buildAnswerBlocks");
  });
});
```

- [ ] **Step 2: Run the tests to verify the orchestrator is missing**

Run: `npm test -- src/test/answer-excellence-runtime.test.ts`

Expected: FAIL because `runAnswerExcellenceEngine` does not exist and `assistant-runtime.ts` still contains the inline quality/block builders.

- [ ] **Step 3: Add the orchestrator and replace the shallow runtime answer path**

```ts
// supabase/functions/_shared/answer-excellence/index.ts
import { choosePresentationFormat } from "./choose-presentation-format.ts";
import { createActionPlan } from "./create-action-plan.ts";
import { enrichWithWebIfUseful } from "./enrich-with-web-if-useful.ts";
import { gatherRelevantEvidence } from "./gather-relevant-evidence.ts";
import { generateHiddenInsights } from "./generate-hidden-insights.ts";
import { inferDecisionIntent } from "./infer-decision-intent.ts";
import { qualityGate } from "./quality-gate.ts";
import { runMultiLensReasoning } from "./run-multi-lens-reasoning.ts";
import type {
  AnswerExcellenceInput,
  DecisionIntent,
  LensFinding,
  RelevantEvidence,
} from "./types.ts";

export async function runAnswerExcellenceEngine(args: {
  input: AnswerExcellenceInput;
  llm: {
    completeJson?: ((payload: {
      systemPrompt: string;
      userPrompt: string;
    }) => Promise<Record<string, unknown>>);
  };
  webSearch: (payload: {
    question: string;
    artistName?: string;
    decisionIntent: DecisionIntent;
    relevantEvidence: RelevantEvidence;
    findings: LensFinding[];
  }) => Promise<Record<string, unknown>>;
}) {
  const decisionIntent = inferDecisionIntent({
    question: args.input.question,
    mode: args.input.mode,
    resolvedEntities: args.input.resolvedEntities,
  });
  const relevantEvidence = gatherRelevantEvidence({
    decisionIntent,
    evidence: args.input.evidence,
    fromDate: args.input.fromDate,
    toDate: args.input.toDate,
  });
  const reasoning = runMultiLensReasoning({ decisionIntent, relevantEvidence });
  const hiddenInsights = generateHiddenInsights({ decisionIntent, relevantEvidence, reasoning });
  const actionPlan = createActionPlan({ decisionIntent, relevantEvidence, reasoning, hiddenInsights });
  const webContext = await args.webSearch({
    question: args.input.question,
    artistName: args.input.resolvedEntities.artist_name,
    decisionIntent,
    relevantEvidence,
    findings: reasoning.findings,
  });
  const synthesis = args.llm.completeJson
    ? await args.llm.completeJson({
      systemPrompt: "Return JSON only. Write a decision-first assistant answer grounded only in the supplied reasoning and evidence.",
      userPrompt: JSON.stringify({
        decisionIntent,
        relevantEvidence,
        reasoning,
        hiddenInsights,
        actionPlan,
        webContext,
      }),
    })
    : {};
  const presentation = choosePresentationFormat({
    decisionIntent,
    relevantEvidence,
    reasoning,
    hiddenInsights,
    actionPlan,
  });
  const gate = qualityGate({
    decisionIntent,
    relevantEvidence,
    reasoning,
    hiddenInsights,
    actionPlan,
    citations: Array.isArray((webContext as { citations?: unknown[] }).citations) ? ((webContext as { citations?: Record<string, unknown>[] }).citations ?? []) : [],
    proposedNarrative: {
      executive_answer: String(synthesis.answer_text ?? ""),
      why_this_matters: String(synthesis.why_this_matters ?? ""),
    },
  });

  const runtimeResponse = {
    answer_title: String(synthesis.answer_title ?? "Decision-grade answer"),
    answer_text: String(synthesis.answer_text ?? actionPlan[0]?.action ?? "Evidence is available, but the answer needs clarification."),
    why_this_matters: String(synthesis.why_this_matters ?? hiddenInsights[0]?.whyItMatters ?? ""),
    kpis: [],
    follow_up_questions: Array.isArray(synthesis.follow_up_questions) ? synthesis.follow_up_questions.slice(0, 3) : [],
    recommendations: actionPlan.map((item) => ({
      action: item.action,
      rationale: item.whyNow,
      impact: item.expectedImpact,
      risk: item.riskIfIgnored,
    })),
    citations: Array.isArray((webContext as { citations?: unknown[] }).citations) ? (webContext as { citations?: Record<string, unknown>[] }).citations : [],
    answer_design: {
      capabilities: reasoning.activeLenses,
      depth: gate.outcome === "pass" && (hiddenInsights.length > 0 || actionPlan.length > 1) ? "deep" : "standard",
      external_enrichment_allowed: decisionIntent.web_enrichment_policy === "conditional",
      evidence_visibility: "collapsed",
    },
    answer_blocks: [
      {
        id: "direct-answer",
        type: "direct_answer",
        priority: 1,
        source: "workspace_data",
        payload: { text: String(synthesis.answer_text ?? "") },
      },
      {
        id: "recommendations",
        type: "recommendations",
        priority: 2,
        source: "workspace_data",
        payload: {
          items: actionPlan.map((item) => ({
            action: item.action,
            rationale: item.whyNow,
            impact: item.expectedImpact,
          })),
        },
      },
      {
        id: "risk-flags",
        type: "risk_flags",
        priority: 3,
        source: "workspace_data",
        payload: {
          items: hiddenInsights.map((item) => item.insight),
        },
      },
    ],
    render_hints: {
      layout: "prose_first",
      density: gate.outcome === "pass" ? "expanded" : "compact",
      visual_preference: "table",
      show_confidence_badges: true,
      evidence_visibility: "collapsed",
      visible_artifact_ids: ["recommendations", "risk-flags"],
      answer_depth: gate.outcome === "pass" ? "deep" : "standard",
    },
    unknowns: relevantEvidence.gaps,
    claims: relevantEvidence.facts.map((fact) => ({
      claim_id: fact.id,
      text: fact.headline,
      supporting_fields: fact.supportingColumns,
      source_ref: args.input.evidence.provenance[0] ?? "workspace_data",
    })),
    quality_outcome: gate.outcome,
    diagnostics: {
      answer_excellence: {
        decision_intent: decisionIntent,
        evidence_fit: relevantEvidence.fit,
        findings: reasoning.findings,
        hidden_insights: hiddenInsights,
        action_plan: actionPlan,
        quality_gate: gate,
      },
    },
  };

  return { decisionIntent, relevantEvidence, reasoning, hiddenInsights, actionPlan, presentation, gate, runtimeResponse };
}

export {
  inferDecisionIntent,
} from "./infer-decision-intent.ts";
export {
  gatherRelevantEvidence,
} from "./gather-relevant-evidence.ts";
export {
  runMultiLensReasoning,
} from "./run-multi-lens-reasoning.ts";
export {
  enrichWithWebIfUseful,
} from "./enrich-with-web-if-useful.ts";
export {
  generateHiddenInsights,
} from "./generate-hidden-insights.ts";
export {
  createActionPlan,
} from "./create-action-plan.ts";
export {
  choosePresentationFormat,
} from "./choose-presentation-format.ts";
export {
  qualityGate,
} from "./quality-gate.ts";
```

```ts
// Replace the assistant-runtime synthesis block in supabase/functions/_shared/assistant-runtime.ts
import { runAnswerExcellenceEngine } from "./answer-excellence/index.ts";

// ...
const excellence = await runAnswerExcellenceEngine({
  input: {
    question: question!,
    mode: config.mode === "workspace" ? "workspace-general" : config.mode,
    resolvedEntities: scope.entityContext,
    fromDate,
    toDate,
    evidence: {
      columns,
      rows,
      rowCount: evidence.row_count,
      scannedRows: evidence.row_count,
      provenance: evidence.provenance,
      systemConfidence: verifier.status === "passed" ? plan.confidence : "low",
      diagnostics: {
        analysis_plan: plan,
        required_columns: requiredColumns,
        chosen_columns: compiled.chosen_columns,
        missing_fields: missingFields,
      },
      selectedColumns: compiled.chosen_columns,
      missingColumns: missingFields,
    },
  },
  llm: {
    completeJson: openAiKey
      ? ({ systemPrompt, userPrompt }) =>
        callOpenAiJson({
          apiKey: openAiKey,
          model,
          systemPrompt,
          userPrompt,
        })
      : undefined,
  },
  webSearch: ({ question, artistName, decisionIntent, relevantEvidence, findings }) =>
    enrichWithWebIfUseful({
      question,
      artistName,
      decisionIntent,
      relevantEvidence,
      findings,
      openAiApiKey: openAiKey,
      openAiSearchModel: Deno.env.get("OPENAI_SEARCH_MODEL") ?? model,
    }),
});

const answerTitle = excellence.runtimeResponse.answer_title;
const answerText = excellence.runtimeResponse.answer_text;
const whyThisMatters = excellence.runtimeResponse.why_this_matters;
const kpis = sanitizeKpis(excellence.runtimeResponse.kpis);
const claims = Array.isArray(excellence.runtimeResponse.claims) ? excellence.runtimeResponse.claims : [];
const answerBlocks = Array.isArray(excellence.runtimeResponse.answer_blocks) ? excellence.runtimeResponse.answer_blocks : [];
const evidenceMap = Object.fromEntries(
  answerBlocks
    .filter((block) => typeof block.id === "string")
    .map((block) => [String(block.id), "workspace_data"]),
);

return new Response(JSON.stringify({
  conversation_id: conversationId,
  runtime_patch: runtimePatch,
  answer_title: answerTitle,
  answer_text: answerText,
  why_this_matters: whyThisMatters,
  kpis,
  table: rows.length > 0 ? { columns, rows: rows.slice(0, 25) } : undefined,
  chart: { type: "none", x: "", y: [], title: undefined },
  evidence,
  follow_up_questions: Array.isArray(excellence.runtimeResponse.follow_up_questions) ? excellence.runtimeResponse.follow_up_questions : [],
  quality_outcome: excellence.runtimeResponse.quality_outcome,
  clarification: excellence.runtimeResponse.clarification,
  resolved_scope: resolvedScope,
  plan_trace: { intent: sql_intent, selected_columns: compiled.chosen_columns, missing_columns: missingFields, column_requirements, constraints },
  claims,
  citations: excellence.runtimeResponse.citations,
  recommendations: excellence.runtimeResponse.recommendations,
  answer_design: excellence.runtimeResponse.answer_design,
  answer_blocks: answerBlocks,
  render_hints: excellence.runtimeResponse.render_hints,
  evidence_map: evidenceMap,
  unknowns: excellence.runtimeResponse.unknowns,
  diagnostics: {
    intent: plan.intent,
    confidence: verifier.status === "passed" ? plan.confidence : "low",
    used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]),
    missing_fields: missingFields,
    strict_mode: false,
    analysis_plan: plan,
    column_requirements,
    required_columns: requiredColumns,
    chosen_columns: compiled.chosen_columns,
    top_n: plan.top_n,
    sort_by: plan.sort_by,
    sort_dir: plan.sort_dir,
    verifier_status: verifier.status,
    insufficiency_reason: null,
    compiler_source: plan_source,
    stage: "verify",
    ...(excellence.runtimeResponse.diagnostics ?? {}),
  },
}), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
```

- [ ] **Step 4: Run the orchestration and runtime wiring tests**

Run: `npm test -- src/test/answer-excellence-runtime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the runtime integration**

```bash
git add src/test/answer-excellence-runtime.test.ts supabase/functions/_shared/answer-excellence/index.ts supabase/functions/_shared/assistant-runtime.ts
git commit -m "feat: wire answer excellence engine into assistant runtime"
```

### Task 5: Thin the AI Insights Router and Preserve Runtime Output

**Files:**
- Modify: `supabase/functions/ai-insights-router-v1/index.ts`
- Test: `src/test/ai-insights-router-runtime-passthrough.test.ts`

- [ ] **Step 1: Write the failing router passthrough test**

```ts
// src/test/ai-insights-router-runtime-passthrough.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const routerPath = path.resolve(process.cwd(), "supabase/functions/ai-insights-router-v1/index.ts");

describe("ai insights router runtime passthrough", () => {
  it("does not depend on the legacy answer policy/design helpers", () => {
    const source = readFileSync(routerPath, "utf8");
    expect(source).not.toContain("../_shared/assistant-answer-design.ts");
    expect(source).not.toContain("../_shared/assistant-answer-policy.ts");
  });

  it("preserves runtime-generated answer blocks and answer design metadata", () => {
    const source = readFileSync(routerPath, "utf8");
    expect(source).toContain("answer_blocks: assistantPayload.answer_blocks ?? undefined");
    expect(source).toContain("answer_design: assistantPayload.answer_design ?? undefined");
    expect(source).toContain("recommendations: assistantPayload.recommendations ?? undefined");
    expect(source).not.toContain("answer_blocks: undefined");
  });
});
```

- [ ] **Step 2: Run the router passthrough test and verify it fails against the current split-brain router**

Run: `npm test -- src/test/ai-insights-router-runtime-passthrough.test.ts`

Expected: FAIL because the router still imports `assistant-answer-design.ts` and `assistant-answer-policy.ts` and overwrites `answer_blocks`.

- [ ] **Step 3: Remove the second business-reasoning pass from the router**

```ts
// In supabase/functions/ai-insights-router-v1/index.ts, remove these imports:
// import { designAssistantAnswer } from "../_shared/assistant-answer-design.ts";
// import { buildDecisionGradeAnswer } from "../_shared/assistant-answer-policy.ts";

// In the runtime-backed artist / track / workspace return blocks, preserve the runtime output instead of rewriting it:
return jsonResponse({
  conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
  resolved_mode: "artist",
  resolved_entities: resolvedEntities,
  answer_title:
    (isNonEmptyString(assistantPayload.answer_title) && assistantPayload.answer_title) ||
    "Artist AI answer",
  executive_answer: isNonEmptyString(assistantPayload.answer_text)
    ? assistantPayload.answer_text
    : "I need stronger verified evidence before I can answer this reliably.",
  why_this_matters: assistantPayload.why_this_matters ?? "",
  evidence: {
    row_count: rowCount,
    scanned_rows: rowCount,
    from_date: assistantPayload.evidence?.from_date ?? fromDate,
    to_date: assistantPayload.evidence?.to_date ?? toDate,
    provenance: Array.isArray(assistantPayload.evidence?.provenance)
      ? assistantPayload.evidence.provenance
      : ["run_artist_chat_sql_v1"],
    system_confidence: confidence,
  },
  kpis,
  visual,
  actions: [
    { label: "Open artist scope", href: `/transactions?artist_key=${encodeURIComponent(resolvedEntities.artist_key ?? "")}`, kind: "primary" },
    { label: "Open reviews", href: "/review-queue", kind: "secondary" },
  ],
  follow_up_questions: followUps.length > 0 ? followUps : [],
  quality_outcome: assistantPayload.quality_outcome ?? undefined,
  resolved_scope: assistantPayload.resolved_scope ?? undefined,
  plan_trace: assistantPayload.plan_trace ?? undefined,
  claims: Array.isArray(assistantPayload.claims) ? assistantPayload.claims : undefined,
  citations: Array.isArray(assistantPayload.citations) ? assistantPayload.citations : undefined,
  recommendations: Array.isArray(assistantPayload.recommendations) ? assistantPayload.recommendations : undefined,
  answer_design: assistantPayload.answer_design ?? undefined,
  answer_blocks: assistantPayload.answer_blocks ?? undefined,
  render_hints: assistantPayload.render_hints ?? undefined,
  evidence_map: assistantPayload.evidence_map ?? undefined,
  unknowns: Array.isArray(assistantPayload.unknowns) ? assistantPayload.unknowns : undefined,
  clarification: assistantPayload.clarification ?? undefined,
  diagnostics: assistantPayload.diagnostics ?? undefined,
});
```

```ts
// Keep only deterministic pre-runtime fallbacks like these:
if (asksArtistLeaderboard && artistRollup.length > 0) {
  // existing workspace leaderboard fallback stays in place
}
if (!assistantPayload || !isNonEmptyString(assistantPayload.answer_text)) {
  return jsonResponse(buildDeterministicFallbackResponse(/* existing args */));
}
```

- [ ] **Step 4: Run the router passthrough test**

Run: `npm test -- src/test/ai-insights-router-runtime-passthrough.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the router thinning**

```bash
git add src/test/ai-insights-router-runtime-passthrough.test.ts supabase/functions/ai-insights-router-v1/index.ts
git commit -m "refactor: thin ai insights router around runtime answers"
```

### Task 6: Extend the AI Answer Viewer for New Support Blocks

**Files:**
- Modify: `src/components/insights/AiAnswerView.tsx`
- Modify: `src/test/ai-answer-view.test.tsx`

- [ ] **Step 1: Add failing UI tests for action-plan, risk-flag, and scenario blocks**

```ts
// Add these tests to src/test/ai-answer-view.test.tsx
it("renders action-plan and risk-flag blocks selected by render hints", () => {
  render(
    <AiAnswerView
      payload={samplePayload({
        answer_blocks: [
          {
            id: "risk-flags",
            type: "risk_flags",
            priority: 2,
            source: "workspace_data",
            title: "Risk flags",
            payload: { items: ["Revenue is overly concentrated in one market."] },
          },
          {
            id: "action-plan",
            type: "action_plan",
            priority: 3,
            source: "workspace_data",
            title: "Action plan",
            payload: {
              items: [
                { action: "Validate the US first", timing: "This week", expected_impact: "Protect the highest-value route." },
              ],
            },
          },
        ] as any,
        render_hints: {
          layout: "prose_first",
          density: "expanded",
          visual_preference: "none",
          show_confidence_badges: true,
          visible_artifact_ids: ["risk-flags", "action-plan"],
        } as any,
      })}
      onUseQuestion={vi.fn()}
    />,
  );

  expect(screen.getByText("Risk flags")).toBeInTheDocument();
  expect(screen.getByText(/Validate the US first/)).toBeInTheDocument();
});

it("renders scenario options as a comparison block", () => {
  render(
    <AiAnswerView
      payload={samplePayload({
        answer_blocks: [
          {
            id: "scenario-options",
            type: "scenario_options",
            priority: 2,
            source: "workspace_data",
            title: "Route options",
            payload: {
              items: [
                { action: "Prioritise London", rationale: "Highest visible upside." },
                { action: "Prioritise Manchester", rationale: "Lower conflict pressure." },
              ],
            },
          },
        ] as any,
        render_hints: {
          layout: "prose_first",
          density: "expanded",
          visual_preference: "none",
          show_confidence_badges: true,
          visible_artifact_ids: ["scenario-options"],
        } as any,
      })}
      onUseQuestion={vi.fn()}
    />,
  );

  expect(screen.getByText("Route options")).toBeInTheDocument();
  expect(screen.getByText("Prioritise London")).toBeInTheDocument();
  expect(screen.getByText("Prioritise Manchester")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the viewer test and verify the new blocks are not rendered yet**

Run: `npm test -- src/test/ai-answer-view.test.tsx`

Expected: FAIL because `AiAnswerView` only renders recommendations, charts, citations, and tables.

- [ ] **Step 3: Add support for action-plan, risk-flag, and scenario blocks**

```tsx
// Add these branches to renderSupportBlock in src/components/insights/AiAnswerView.tsx
if (block.type === "risk_flags") {
  const items = Array.isArray((block.payload as { items?: unknown }).items)
    ? ((block.payload as { items?: unknown[] }).items ?? [])
    : [];
  return (
    <Card key={block.id}>
      <CardHeader>
        <CardTitle>{block.title ?? "Risk Flags"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, idx) => (
          <p key={`${block.id}-${idx}`} className="text-sm text-muted-foreground">
            {String(item)}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

if (block.type === "action_plan" || block.type === "scenario_options") {
  const items = Array.isArray((block.payload as { items?: unknown }).items)
    ? ((block.payload as { items?: unknown[] }).items ?? [])
    : [];
  return (
    <Card key={block.id}>
      <CardHeader>
        <CardTitle>{block.title ?? (block.type === "action_plan" ? "Action Plan" : "Options")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item, idx) => {
          const record = (item ?? {}) as Record<string, unknown>;
          return (
            <div key={`${block.id}-${idx}`} className="space-y-1">
              <p className="text-sm font-semibold">{String(record.action ?? record.title ?? `Option ${idx + 1}`)}</p>
              {record.rationale ? <p className="text-sm text-muted-foreground">{String(record.rationale)}</p> : null}
              {record.timing ? <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{String(record.timing)}</p> : null}
              {record.expected_impact ? <p className="text-sm text-muted-foreground">{String(record.expected_impact)}</p> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the viewer tests**

Run: `npm test -- src/test/ai-answer-view.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit the viewer support**

```bash
git add src/components/insights/AiAnswerView.tsx src/test/ai-answer-view.test.tsx
git commit -m "feat: render answer excellence support blocks"
```

### Task 7: Remove Legacy Split-Brain Helpers and Run Full Regression

**Files:**
- Delete: `supabase/functions/_shared/assistant-answer-design.ts`
- Delete: `supabase/functions/_shared/assistant-answer-policy.ts`
- Delete: `src/test/assistant-answer-design.test.ts`
- Delete: `src/test/assistant-answer-policy.test.ts`
- Create: `src/test/answer-excellence-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
// src/test/answer-excellence-migration.test.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const routerPath = path.resolve(process.cwd(), "supabase/functions/ai-insights-router-v1/index.ts");
const legacyDesignPath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-answer-design.ts");
const legacyPolicyPath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-answer-policy.ts");

describe("answer excellence migration", () => {
  it("removes the legacy answer policy and design helpers", () => {
    const routerSource = readFileSync(routerPath, "utf8");
    expect(routerSource).not.toContain("assistant-answer-design");
    expect(routerSource).not.toContain("assistant-answer-policy");
    expect(existsSync(legacyDesignPath)).toBe(false);
    expect(existsSync(legacyPolicyPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the migration test and verify the legacy modules still exist**

Run: `npm test -- src/test/answer-excellence-migration.test.ts`

Expected: FAIL because the two legacy helper files still exist.

- [ ] **Step 3: Delete the legacy modules and their obsolete tests**

```bash
git rm supabase/functions/_shared/assistant-answer-design.ts
git rm supabase/functions/_shared/assistant-answer-policy.ts
git rm src/test/assistant-answer-design.test.ts
git rm src/test/assistant-answer-policy.test.ts
```

- [ ] **Step 4: Run the focused migration test and then the full regression suite**

Run: `npm test -- src/test/answer-excellence-migration.test.ts`
Expected: PASS

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: Vite production build completes without TypeScript or bundling errors.

- [ ] **Step 5: Commit the cleanup and regression pass**

```bash
git add src/test/answer-excellence-migration.test.ts
git commit -m "refactor: remove legacy answer policy split brain"
```
