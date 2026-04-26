# Answer Excellence Engine Design

## Objective

Build a shared Answer Excellence Engine that turns verified OrderSounds query results into decision-grade business intelligence for track, artist, and workspace questions without changing the existing database layer or breaking the current UI response contract.

The engine must eliminate shallow summaries, unsupported narratives, generic marketing advice, and descriptive answers that do not help the user make a decision. Internal workspace data remains the source of truth. Web context is optional, tightly gated, and can only enrich a decision when it materially changes timing, prioritization, or risk.

## Current State

The current answer path is split across two layers:

- `supabase/functions/_shared/assistant-runtime.ts`
  - resolves scope
  - plans and verifies SQL
  - calls the model for a shallow answer shape
  - returns partially structured blocks
- `supabase/functions/ai-insights-router-v1/index.ts`
  - interprets the question again
  - applies another answer-policy layer
  - sometimes rewrites the answer
  - sometimes adds external context and presentation metadata

This split causes answer drift, duplicated heuristics, and inconsistent quality between track, artist, and workspace flows. The shared runtime has the best access to verified evidence and diagnostics, so the excellence layer should live there instead of in the router.

## Design Decision

Implement the new engine in `supabase/functions/_shared/answer-excellence/` and make it the primary post-query reasoning layer inside `assistant-runtime.ts`.

The runtime keeps ownership of:

- scope resolution
- catalog loading
- plan generation
- SQL compilation
- SQL execution
- verification
- thread state persistence

The Answer Excellence Engine owns:

- decision intent inference
- evidence normalization
- multi-lens reasoning
- optional web enrichment gating and synthesis
- hidden insight generation
- action plan generation
- presentation selection
- answer block construction
- final quality gating

The router becomes thin:

- mode/entity resolution
- deterministic fallbacks for hard failure cases that happen before the runtime can answer
- response passthrough
- no second business-reasoning layer

## Goals

- Produce answers that are decision-first rather than summary-first.
- Keep internal workspace data as the authoritative source.
- Force at least one non-obvious insight for supported questions.
- Make every supported answer end with an actionable next move.
- Keep the existing `AiInsightsTurnResponse` contract stable for the UI.
- Make answer quality testable with deterministic fixtures rather than prompt-only behavior.

## Non-Goals

- Rebuilding the database layer
- Replacing the existing query planner
- Replacing verified SQL execution with agentic free-form querying
- Reworking the frontend response viewer contract
- Making web enrichment mandatory

## Module Layout

Create a new shared module family:

- `supabase/functions/_shared/answer-excellence/types.ts`
- `supabase/functions/_shared/answer-excellence/infer-decision-intent.ts`
- `supabase/functions/_shared/answer-excellence/gather-relevant-evidence.ts`
- `supabase/functions/_shared/answer-excellence/run-multi-lens-reasoning.ts`
- `supabase/functions/_shared/answer-excellence/enrich-with-web-if-useful.ts`
- `supabase/functions/_shared/answer-excellence/generate-hidden-insights.ts`
- `supabase/functions/_shared/answer-excellence/create-action-plan.ts`
- `supabase/functions/_shared/answer-excellence/choose-presentation-format.ts`
- `supabase/functions/_shared/answer-excellence/quality-gate.ts`
- `supabase/functions/_shared/answer-excellence/index.ts`

### Module Responsibilities

#### `inferDecisionIntent()`

Inputs:

- normalized question text
- scope mode
- resolved entities
- existing diagnostics

Outputs:

- `intent`
- `real_decision`
- `urgency_level`
- `departments_impacted`
- `question_family`
- `allowed_lenses`
- `required_evidence_classes`
- `web_enrichment_policy`

This module classifies the actual decision the user is trying to make, not just the topic. It converts questions such as:

- "Where should this artist tour next quarter?" into profitable routing / market validation
- "Which tracks carry revenue?" into concentration / monetization allocation
- "Why is revenue down?" into anomaly diagnosis / driver decomposition

#### `gatherRelevantEvidence()`

Inputs:

- verified rows and columns
- evidence metadata
- planner diagnostics
- scope context
- optional rights/catalog/contract metadata already available in runtime scope

Outputs:

- normalized facts
- evidence strength flags
- computed metrics
- ranked driver candidates
- decision-critical gaps
- evidence ids for downstream traceability

This module converts rows into deterministic signals before any narrative generation. It should compute:

- concentration by track, territory, platform, usage type, or rights counterparty when available
- time-series deltas and contribution-to-change
- volatility and recency markers
- dependency on one asset, territory, DSP, or contract lane
- quality blockers and insufficiency flags
- evidence fit against the inferred decision

#### `runMultiLensReasoning()`

Inputs:

- decision intent
- normalized evidence

Outputs:

- active lenses
- structured findings
- lens-specific implications

Supported lenses:

- finance
- growth
- operations
- market timing
- risk
- competitive context
- artist brand
- long-term catalog value

Only relevant lenses should be activated. Each finding must cite evidence ids and cannot introduce unsupported facts.

#### `enrichWithWebIfUseful()`

Inputs:

- decision intent
- evidence sufficiency
- selected findings
- optional artist or market anchors

Outputs:

- `used: boolean`
- `decision_use`
- `summary`
- `citations`
- `shelf_life`
- `cannot_override_internal_claims: true`

This module is optional and only runs when external context materially improves the decision. Allowed examples:

- tour or festival conflicts
- platform policy changes
- release timing conflicts
- city seasonality
- chart momentum
- competitor releases
- licensing windows

Rejected examples:

- generic social strategy
- broad music industry trend summaries
- external facts that do not change the recommendation

#### `generateHiddenInsights()`

Inputs:

- findings
- normalized evidence
- decision intent

Outputs:

- one or more non-obvious insights with evidence references

Hidden insights must change a decision. Valid patterns include:

- concentration risk
- underpriced growth territory
- overdependence on one DSP
- weak secondary driver behind one dominant asset
- dormant catalog upside
- mistimed release window
- rights or collection gaps suppressing upside

#### `createActionPlan()`

Inputs:

- findings
- hidden insights
- decision intent

Outputs:

- prioritized actions
- owners
- timing
- expected upside or risk reduction
- rationale linked to findings

Every action must be evidence-backed. No free-floating recommendations are allowed.

#### `choosePresentationFormat()`

Inputs:

- decision intent
- evidence shape
- findings
- hidden insights
- action plan

Outputs:

- presentation mode
- block order
- render hints
- visible artifacts

Supported output modes:

- executive memo
- ranked list
- scenario comparison
- chart-led answer
- table-led answer
- warning-first answer
- timeline

This module chooses format after the reasoning is complete, not before.

#### `qualityGate()`

Inputs:

- decision intent
- findings
- hidden insights
- action plan
- citations
- proposed final response

Outputs:

- `pass`
- `clarify`
- `constrained`
- explicit reasons
- missing requirements

This module blocks low-value outputs. It should reject or constrain answers that are:

- generic
- unsupported
- non-actionable
- descriptive without a decision
- missing a non-obvious insight when the evidence is sufficient
- over-claiming beyond the available dimensions
- using web context when it was not justified

## Shared Data Contracts

### `AnswerExcellenceInput`

```ts
type AnswerExcellenceInput = {
  question: string;
  mode: "track" | "artist" | "workspace-general";
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
  webPolicy: {
    allowEnrichment: boolean;
    forceDisabledReason?: string;
  };
  runtimeMeta: {
    conversationId: string;
    scopeToken?: string;
    runtimePatch: string;
    sourceFunction: string;
  };
};
```

### `AnswerExcellenceResult`

```ts
type AnswerExcellenceResult = {
  decisionIntent: {
    intent: string;
    realDecision: string;
    urgencyLevel: "immediate" | "planning_cycle" | "exploratory";
    departmentsImpacted: string[];
    questionFamily: string;
  };
  evidenceBrief: {
    strengths: string[];
    gaps: string[];
    supportingEvidenceIds: string[];
    fit: "strong" | "partial" | "weak";
  };
  reasoning: {
    activeLenses: string[];
    findings: Array<{
      id: string;
      lens: string;
      headline: string;
      implication: string;
      confidence: "high" | "medium" | "low";
      evidenceIds: string[];
      decisionRelevance: "primary" | "secondary";
    }>;
  };
  hiddenInsights: Array<{
    id: string;
    insight: string;
    whyItMatters: string;
    evidenceIds: string[];
  }>;
  actionPlan: Array<{
    id: string;
    action: string;
    whyNow: string;
    owner: string;
    timing: string;
    expectedImpact: string;
    riskIfIgnored: string;
    supportingFindingIds: string[];
  }>;
  presentation: {
    format: "memo" | "ranked_list" | "comparison" | "chart" | "table" | "warning_first" | "timeline";
    answerBlocks: Array<Record<string, unknown>>;
    renderHints: Record<string, unknown>;
  };
  citations: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  unknowns: string[];
  qualityGate: {
    outcome: "pass" | "clarify" | "constrained";
    reasons: string[];
    missingRequirements: string[];
  };
  finalResponse: Record<string, unknown>; // stable with the current AiInsightsTurnResponse contract
};
```

## End-to-End Reasoning Flow

### 1. Infer the decision

The first step is to decide what business choice the user is really trying to make. The output must state:

- the intent
- the real decision
- urgency
- impacted departments
- the evidence classes needed to support the decision

This is stricter than the current objective classifier. It should be able to distinguish:

- ranking for allocation
- anomaly diagnosis
- risk triage
- timing choice
- market expansion
- rights or entitlement interpretation

### 2. Gather grounded evidence

This step turns verified result rows into a structured evidence graph. The model is not allowed to invent metrics here. It only receives:

- what the data clearly shows
- what it partially shows
- what it does not support

This step should also label insufficiency cases early. Example:

- platform-only data cannot answer territory prioritization
- one period cannot support trend claims
- revenue rows without contract terms cannot support exact payout claims

### 3. Run relevant lenses

The engine applies only the lenses that help the decision.

Examples:

- Touring:
  - finance
  - growth
  - market timing
  - operations
  - risk
- Revenue drop:
  - finance
  - operations
  - risk
- Catalog or publishing:
  - rights
  - long-term catalog value
  - finance
  - licensing upside

Each lens emits findings, not prose paragraphs. Narrative synthesis happens later.

### 4. Generate non-obvious insight

If the answer is supportable, this step must create at least one insight the user did not explicitly ask for. Examples:

- one track is carrying too much of the quarter
- the strongest revenue territory may not be the strongest live market without venue validation
- one DSP is dominant enough to create platform risk
- older catalog is flat overall but one territory shows reactivation potential
- rights ambiguity is suppressing confidence in an otherwise promising asset

### 5. Build an action plan

The answer must tell the user what to do next, in order, and why. Actions should be prioritized and time-bounded. Example action classes:

- defend a winner
- fund a secondary growth test
- validate a touring market
- fix a rights or data blocker
- reallocate marketing support
- reactivate dormant catalog in a specific territory

### 6. Choose presentation format

The engine chooses the output shape after reasoning:

- memo for executive or strategic questions
- ranked list for allocation questions
- scenario comparison for tradeoff questions
- warning-first layout for risk-heavy answers
- chart/table only when they help the decision

### 7. Quality gate

The gate verifies that the answer:

- names the decision explicitly
- stays grounded in evidence
- reveals something non-obvious
- gives immediate next steps
- uses external context only when justified
- clears the enterprise-quality bar

## Response Assembly Rules

The engine should assemble the final `AiInsightsTurnResponse` payload directly. It must populate:

- `executive_answer`
- `why_this_matters`
- `quality_outcome`
- `claims`
- `citations`
- `unknowns`
- `recommendations`
- `answer_blocks`
- `render_hints`
- `answer_design`
- `diagnostics.answer_excellence`

The current viewer contract should remain stable. New metadata should be additive.

## Web Enrichment Policy

Web enrichment is allowed only when all of the following are true:

- the question is decision-oriented
- internal evidence is already sufficient to frame the answer
- one external fact would materially improve timing, prioritization, or risk judgment

Web enrichment is not allowed to:

- replace internal revenue truth
- introduce unsupported narratives
- pad the answer with broad trends
- override internal evidence

If web context is used, the answer must mark it as contextual rather than authoritative. If web context conflicts with internal evidence, the internal evidence wins and the external fact is presented only as timing or risk context.

## Integration Plan

### `assistant-runtime.ts`

Replace the current shallow synthesis path with:

1. verified SQL result
2. normalized `AnswerExcellenceInput`
3. `runAnswerExcellenceEngine()`
4. return `finalResponse`

The runtime should still be responsible for:

- planner diagnostics
- verification status
- scope persistence
- safe degradation when no rows are available

### `ai-insights-router-v1/index.ts`

Reduce the router so it no longer performs a second business-reasoning pass for normal runtime-backed answers. The router should:

- preserve deterministic special-case fallbacks that happen before runtime invocation
- forward runtime-produced answer blocks and hints
- stop rewriting runtime answers with separate policy heuristics

This removes answer drift between runtime and router layers.

## Testing Strategy

Add targeted tests at three levels.

### Unit tests

Create unit tests for each module using deterministic fixtures:

- `inferDecisionIntent()`
- `gatherRelevantEvidence()`
- `runMultiLensReasoning()`
- `generateHiddenInsights()`
- `createActionPlan()`
- `qualityGate()`

### Policy and regression tests

Add fixtures that prove the engine blocks bad behavior:

- generic marketing advice is rejected
- territory recommendations are constrained when only platform data exists
- trend claims are blocked without a usable time axis
- exact payout claims are blocked without contract terms
- web enrichment is rejected when it does not change the decision

### Golden answer tests

Add golden fixtures for core question families:

- touring
- revenue concentration
- revenue decline diagnosis
- marketing allocation
- catalog value and reactivation
- publishing and rights
- quality blocker analysis
- executive portfolio strategy

### Integration tests

Verify that:

- `insights-track-chat`
- `insights-artist-chat`
- `insights-workspace-chat`

all route through the shared engine and emit stable `AiInsightsTurnResponse` shapes.

## Rollout Strategy

Roll out in two phases.

### Phase 1

- add the shared engine
- wire it into `assistant-runtime.ts`
- keep the response contract stable
- add deterministic tests for module behavior and output quality

### Phase 2

- remove or bypass redundant router answer-policy rewrites for runtime-backed answers
- keep router-only deterministic fallbacks for failure cases
- consolidate remaining duplicated heuristics into the shared engine

This reduces risk while still moving answer quality logic to the correct layer.

## Success Criteria

The design is successful when:

- the same reasoning standard applies across track, artist, and workspace questions
- answers explicitly name the decision being supported
- answers surface at least one non-obvious insight when supported by evidence
- every recommendation is grounded and actionable
- unsupported answers degrade honestly
- web enrichment is rare, deliberate, and decision-relevant
- the router no longer fights the runtime over answer meaning

## Open Questions Resolved In This Design

- Where should the engine live?
  - In the shared runtime layer, not the router.
- Should the database layer change?
  - No.
- Should the UI contract change?
  - No, only additive metadata.
- Should web search be broad and default-on?
  - No, strict and optional.
- Should one model prompt own the whole answer?
  - No, deterministic staged reasoning with structured outputs.
