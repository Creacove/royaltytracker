#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PROMPTS_PATH = path.resolve("scripts", "artist-benchmark-prompts.json");
const DEFAULT_RESULTS_PATH = path.resolve("scripts", "artist-benchmark-results.json");
const DEFAULT_REPORT_PATH = path.resolve("scripts", "artist-benchmark-report.md");
const HISTORY_DIR = path.resolve("scripts", "benchmark-history");
const DEFAULT_MAX_ITERATIONS = 5;

const QUALITY_GATE_MEDIAN = 8.0;
const QUALITY_GATE_MIN = 7.0;
const QUALITY_GATE_MIN_SHARE = 0.9;

const CRITICAL_FLAGS = new Set([
  "runtime_error",
  "schema_error",
  "constrained_unexpected",
  "cross_intent_recommendation_drift",
  "internal_external_conflict",
]);

const CURATED_PROMPTS = [
  {
    id: "artist-live-001",
    question: "Where are the biggest attribution and mapping gaps likely distorting net revenue decisions, and what is the 30-day remediation order by expected financial impact?",
    persona: "publisher",
    intent: "quality_risk_impact",
    required_evidence: ["gross_revenue", "net_revenue", "mapping_confidence", "validation_status"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-002",
    question: "Which tracks in this artist's catalog have high usage but low effective royalty rate by rights type this year, and what contract/data issue should we investigate first?",
    persona: "publisher",
    intent: "rights_leakage",
    required_evidence: ["track_title", "quantity", "net_revenue", "rights_type"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-003",
    question: "Compare last 6 months vs prior 6 months by platform and recommend 3 actions.",
    persona: "marketer",
    intent: "period_comparison_platform",
    required_evidence: ["platform", "period_bucket", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-004",
    question: "Show net revenue week by week for the last 16 weeks by platform, and identify where momentum broke.",
    persona: "marketer",
    intent: "trend_break",
    required_evidence: ["week_start", "platform", "net_revenue"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-005",
    question: "Which platforms are driving revenue concentration risk, and what should we do next quarter?",
    persona: "marketer",
    intent: "platform_concentration",
    required_evidence: ["platform", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-006",
    question: "Which territories are under-monetized relative to usage, and what should we do first?",
    persona: "marketer",
    intent: "under_monetized_territory",
    required_evidence: ["territory", "quantity", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-007",
    question: "Where should this artiste tour and why?",
    persona: "tour_manager",
    intent: "touring_live",
    required_evidence: ["territory", "gross_revenue"],
    expected_depth: "deep",
    requires_external: true,
    expect_answerable: true,
  },
  {
    id: "artist-live-008",
    question: "Where should this artiste tour next quarter, and what should we validate before booking dates?",
    persona: "tour_manager",
    intent: "touring_live_future",
    required_evidence: ["territory", "gross_revenue", "net_revenue"],
    expected_depth: "deep",
    requires_external: true,
    expect_answerable: true,
  },
  {
    id: "artist-live-009",
    question: "Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?",
    persona: "tour_manager",
    intent: "touring_validation",
    required_evidence: ["territory", "net_revenue"],
    expected_depth: "deep",
    requires_external: true,
    expect_answerable: true,
  },
  {
    id: "artist-live-010",
    question: "If budget is limited, what 2 no-regret moves should we make this quarter?",
    persona: "executive",
    intent: "budget_no_regret",
    required_evidence: ["net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-011",
    question: "What should this artist focus on in 2026: growth, risk reduction, or diversification?",
    persona: "label_head",
    intent: "portfolio_choice",
    required_evidence: ["track_title", "net_revenue", "gross_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-012",
    question: "If we wanted a 20% uplift in net revenue, which 3 levers are most realistic from current data?",
    persona: "label_head",
    intent: "uplift_levers",
    required_evidence: ["net_revenue", "track_title", "platform"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-013",
    question: "If we had to choose between doubling down on top performers vs building the mid-tier catalog, which strategy has better 2-quarter upside-adjusted risk?",
    persona: "label_head",
    intent: "portfolio_tradeoff",
    required_evidence: ["track_title", "period_bucket", "net_revenue"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-014",
    question: "Which 5 tracks have the highest net revenue this year, and what explains the gap to #2-#5?",
    persona: "label_head",
    intent: "track_ranking_gap",
    required_evidence: ["track_title", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-015",
    question: "Compare this year vs last year by platform and territory, then give an executive recommendation.",
    persona: "executive",
    intent: "year_over_year",
    required_evidence: ["platform", "territory", "period_bucket", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-016",
    question: "Show net revenue day by day for the last 30 days and explain the biggest spike.",
    persona: "marketer",
    intent: "daily_spike",
    required_evidence: ["day_start", "net_revenue"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-017",
    question: "Which platform-territory pairs have the largest gross-to-net gap this year, and what should we fix first?",
    persona: "publisher",
    intent: "gap_analysis",
    required_evidence: ["platform", "territory", "gross_revenue", "net_revenue", "gross_net_gap_abs"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-018",
    question: "Which entities have the highest confidence risk (mapping/validation) but high revenue impact, and what is the no-regret remediation order?",
    persona: "publisher",
    intent: "quality_risk_impact",
    required_evidence: ["track_title", "gross_revenue", "mapping_confidence", "validation_status"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-019",
    question: "If budget is cut by 40%, what 2 moves should we keep and what 1 move should we pause?",
    persona: "executive",
    intent: "budget_cut",
    required_evidence: ["track_title", "platform", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-020",
    question: "What should we stop doing immediately because it has low upside or high execution risk?",
    persona: "executive",
    intent: "stop_doing",
    required_evidence: ["track_title", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-021",
    question: "Which audience segments (platform + territory + release age bucket) are responding best to recent campaigns, and where should we cut spend immediately?",
    persona: "marketer",
    intent: "audience_segment_roi",
    required_evidence: ["platform", "territory", "net_revenue"],
    expected_depth: "deep",
    requires_external: true,
    expect_answerable: true,
  },
  {
    id: "artist-live-022",
    question: "Compare last 12 weeks vs prior 12 weeks by platform and territory, then give 3 campaign moves with expected impact.",
    persona: "marketer",
    intent: "campaign_compare",
    required_evidence: ["platform", "territory", "period_bucket", "net_revenue"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-023",
    question: "Month by month for the last 12 months, which channel is growing fastest and which is declining?",
    persona: "marketer",
    intent: "monthly_channel_growth",
    required_evidence: ["month_start", "platform", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-024",
    question: "Which data quality issues are most likely distorting our revenue decisions right now?",
    persona: "publisher",
    intent: "quality_risk_impact",
    required_evidence: ["gross_revenue", "net_revenue", "mapping_confidence", "validation_status"],
    expected_depth: "deep",
    requires_external: false,
    expect_answerable: true,
  },
  {
    id: "artist-live-025",
    question: "If we reallocate 25% of next-quarter budget, where should it come from and where should it go?",
    persona: "executive",
    intent: "reallocation",
    required_evidence: ["platform", "territory", "net_revenue"],
    expected_depth: "decision",
    requires_external: false,
    expect_answerable: true,
  },
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      opts[key] = true;
      continue;
    }
    opts[key] = next;
    i += 1;
  }
  return opts;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toStr(value) {
  return typeof value === "string" ? value : "";
}

function countMatches(text, terms) {
  const haystack = toStr(text).toLowerCase();
  return terms.filter((term) => haystack.includes(term.toLowerCase())).length;
}

function compactExcerpt(text, maxLen = 320) {
  const clean = toStr(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

function detectIntent(result) {
  return toStr(result?.diagnostics?.intent) ||
    toStr(result?.detected_intent) ||
    "unknown";
}

function detectQualityOutcome(result) {
  return toStr(result?.quality_outcome) || "unknown";
}

function getRecommendationTexts(result) {
  const blocks = Array.isArray(result?.recommendations) ? result.recommendations : [];
  return blocks
    .map((item) => (item && typeof item === "object" ? toStr(item.action) : ""))
    .filter((v) => v.length > 0);
}

function hasTourDrift(prompt, recommendationTexts) {
  if (!prompt.intent.startsWith("touring")) return false;
  const text = recommendationTexts.join(" ").toLowerCase();
  return /\brights|mapping|validation status|royalty leakage|payout leakage\b/.test(text);
}

function hasRightsDrift(prompt, recommendationTexts) {
  if (!/rights|quality_risk|gap_analysis/.test(prompt.intent)) return false;
  const text = recommendationTexts.join(" ").toLowerCase();
  return /\blive routing|city shortlist|booking dates|venue hold\b/.test(text);
}

function evidenceColumns(result) {
  const visualCols = Array.isArray(result?.visual?.columns) ? result.visual.columns : [];
  const tableCols = Array.isArray(result?.table?.columns) ? result.table.columns : [];
  return new Set(
    [...visualCols, ...tableCols]
      .filter((c) => typeof c === "string")
      .map((c) => c.toLowerCase()),
  );
}

function scoreResult(prompt, runResult) {
  const response = runResult.response;
  const safetyFlags = [];
  const recommendationTexts = response ? getRecommendationTexts(response) : [];
  const citationsCount = Array.isArray(response?.citations) ? response.citations.length : 0;
  const qualityOutcome = detectQualityOutcome(response);
  const intentDetected = detectIntent(response);

  if (runResult.status !== "ok") safetyFlags.push("runtime_error");
  if (!response || typeof response !== "object") safetyFlags.push("schema_error");
  if (prompt.expect_answerable && qualityOutcome === "constrained") safetyFlags.push("constrained_unexpected");
  if (hasTourDrift(prompt, recommendationTexts) || hasRightsDrift(prompt, recommendationTexts)) {
    safetyFlags.push("cross_intent_recommendation_drift");
  }

  if (prompt.requires_external && citationsCount === 0) {
    safetyFlags.push("missing_external_citations");
  }

  const cols = evidenceColumns(response);
  const evidenceMatches = prompt.required_evidence
    .map((required) => required.toLowerCase())
    .filter((required) => cols.has(required)).length;
  const evidenceCoverage = prompt.required_evidence.length === 0 ? 1 : (evidenceMatches / prompt.required_evidence.length);

  const answerText = toStr(response?.executive_answer) || toStr(response?.answer_text);
  const whyText = toStr(response?.why_this_matters);
  const directness = answerText.length > 80 ? 10 : answerText.length > 30 ? 7 : answerText.length > 0 ? 4 : 0;
  const evidenceFidelity = Math.round(evidenceCoverage * 10);
  const actionability = recommendationTexts.length >= 3 ? 10 : recommendationTexts.length === 2 ? 8 : recommendationTexts.length === 1 ? 5 : 0;
  const riskHandling = /\brisk|uncertain|validate|confidence|warning|caution\b/i.test(`${whyText} ${recommendationTexts.join(" ")}`) ? 9 : 4;
  const recommendationRelevance = safetyFlags.includes("cross_intent_recommendation_drift") ? 2 : 9;
  const consistency = qualityOutcome === "constrained" && prompt.expect_answerable ? 3 : 8;
  const enrichmentUsefulness = prompt.requires_external ? (citationsCount > 0 ? 8 : 2) : 7;

  const weightedScore =
    (directness * 0.17) +
    (evidenceFidelity * 0.21) +
    (actionability * 0.2) +
    (riskHandling * 0.14) +
    (recommendationRelevance * 0.14) +
    (consistency * 0.09) +
    (enrichmentUsefulness * 0.05);

  const qualityScore = Number(weightedScore.toFixed(2));
  const criticalFlags = safetyFlags.filter((flag) => CRITICAL_FLAGS.has(flag));
  const pass = criticalFlags.length === 0 && qualityScore >= QUALITY_GATE_MIN;

  return {
    prompt_id: prompt.id,
    question: prompt.question,
    context: runResult.context,
    status: runResult.status,
    quality_score: qualityScore,
    quality_breakdown: {
      directness,
      evidence_fidelity: evidenceFidelity,
      actionability,
      risk_uncertainty: riskHandling,
      recommendation_relevance: recommendationRelevance,
      consistency,
      enrichment_usefulness: enrichmentUsefulness,
    },
    safety_flags: safetyFlags,
    critical_flags: criticalFlags,
    intent_detected: intentDetected,
    quality_outcome: qualityOutcome,
    response_excerpt: compactExcerpt(answerText),
    diagnostics: response?.diagnostics ?? null,
    citations_count: citationsCount,
    pass,
    response: response ?? null,
  };
}

function aggregateResults(scoredRows) {
  const scores = scoredRows.map((row) => row.quality_score);
  const medianScore = median(scores);
  const belowThreshold = scoredRows.filter((row) => row.quality_score < QUALITY_GATE_MIN).length;
  const minSharePassing = scoredRows.length === 0 ? 0 : 1 - (belowThreshold / scoredRows.length);
  const criticalFailureCount = scoredRows.reduce((sum, row) => sum + row.critical_flags.length, 0);

  const gate = {
    critical_failure_count: criticalFailureCount,
    median_quality: Number(medianScore.toFixed(2)),
    share_at_or_above_7: Number(minSharePassing.toFixed(4)),
    min_share_required: QUALITY_GATE_MIN_SHARE,
    median_required: QUALITY_GATE_MEDIAN,
    pass:
      criticalFailureCount === 0 &&
      medianScore >= QUALITY_GATE_MEDIAN &&
      minSharePassing >= QUALITY_GATE_MIN_SHARE,
  };

  return {
    gate,
    summary: {
      total: scoredRows.length,
      pass_count: scoredRows.filter((row) => row.pass).length,
      fail_count: scoredRows.filter((row) => !row.pass).length,
      mean_quality: Number(mean(scores).toFixed(2)),
      median_quality: Number(medianScore.toFixed(2)),
      below_7_count: belowThreshold,
    },
  };
}

function clusterFailures(scoredRows) {
  const failed = scoredRows.filter((row) => !row.pass);
  const byIntent = new Map();
  const byFlag = new Map();

  for (const row of failed) {
    const intent = row.intent_detected || "unknown";
    byIntent.set(intent, (byIntent.get(intent) ?? 0) + 1);
    for (const flag of row.safety_flags) byFlag.set(flag, (byFlag.get(flag) ?? 0) + 1);
  }

  const intents = Array.from(byIntent.entries()).sort((a, b) => b[1] - a[1]);
  const flags = Array.from(byFlag.entries()).sort((a, b) => b[1] - a[1]);
  return { intents, flags };
}

function suggestPatchTarget(row) {
  const notes = [];
  const flags = new Set(row.safety_flags);
  if (flags.has("runtime_error") || flags.has("schema_error")) notes.push("compiler");
  if (flags.has("constrained_unexpected")) notes.push("planner");
  if (flags.has("cross_intent_recommendation_drift")) notes.push("recommender");
  if (row.quality_breakdown.evidence_fidelity < 6) notes.push("planner");
  if (row.quality_breakdown.actionability < 6) notes.push("composer");
  if (row.quality_breakdown.enrichment_usefulness < 6) notes.push("enrichment");
  if (notes.length === 0) notes.push("composer");
  return Array.from(new Set(notes)).join(", ");
}

function renderReport(scoredRows, aggregate, outputPath) {
  const failed = scoredRows.filter((row) => !row.pass);
  const topFailures = [...failed].sort((a, b) => b.critical_flags.length - a.critical_flags.length || a.quality_score - b.quality_score).slice(0, 10);
  const clusters = clusterFailures(scoredRows);
  const lines = [];
  lines.push("# Artist Benchmark Report");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Total prompts: ${aggregate.summary.total}`);
  lines.push(`- Gate pass: ${aggregate.gate.pass ? "YES" : "NO"}`);
  lines.push(`- Critical failures: ${aggregate.gate.critical_failure_count}`);
  lines.push(`- Median quality: ${aggregate.gate.median_quality} (required >= ${aggregate.gate.median_required})`);
  lines.push(`- Share >= 7.0: ${(aggregate.gate.share_at_or_above_7 * 100).toFixed(1)}% (required >= ${(aggregate.gate.min_share_required * 100).toFixed(1)}%)`);
  lines.push("");
  lines.push("## Top Failing Prompts");
  lines.push("");
  if (topFailures.length === 0) {
    lines.push("No failing prompts.");
  } else {
    for (const row of topFailures) {
      lines.push(`- \`${row.prompt_id}\` score=${row.quality_score} flags=[${row.safety_flags.join(", ") || "none"}] target=${suggestPatchTarget(row)}`);
      lines.push(`  - Q: ${row.question}`);
      lines.push(`  - Excerpt: ${row.response_excerpt || "(empty)"}`);
    }
  }
  lines.push("");
  lines.push("## Failure Clusters");
  lines.push("");
  lines.push("### By intent");
  for (const [intent, count] of clusters.intents) lines.push(`- ${intent}: ${count}`);
  if (clusters.intents.length === 0) lines.push("- none");
  lines.push("");
  lines.push("### By safety flag");
  for (const [flag, count] of clusters.flags) lines.push(`- ${flag}: ${count}`);
  if (clusters.flags.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Patch Targets");
  lines.push("");
  const targetCounts = new Map();
  for (const row of failed) {
    const target = suggestPatchTarget(row);
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }
  const sortedTargets = Array.from(targetCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [target, count] of sortedTargets) lines.push(`- ${target}: ${count}`);
  if (sortedTargets.length === 0) lines.push("- none");

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

function writeHistory(resultsPath, reportPath) {
  ensureDir(HISTORY_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(HISTORY_DIR, stamp);
  ensureDir(runDir);
  fs.copyFileSync(resultsPath, path.join(runDir, path.basename(resultsPath)));
  if (fs.existsSync(reportPath)) fs.copyFileSync(reportPath, path.join(runDir, path.basename(reportPath)));
}

function writePromptsFile(outputPath) {
  fs.writeFileSync(outputPath, JSON.stringify(CURATED_PROMPTS, null, 2));
  console.log(`Generated ${CURATED_PROMPTS.length} curated benchmark prompts at ${outputPath}`);
}

async function invokeRouter({
  endpoint,
  key,
  bearerToken,
  body,
  retries = 2,
}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = toStr(json?.error) || `HTTP ${resp.status}`;
        if (attempt < retries && resp.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        return { ok: false, statusCode: resp.status, data: json, error: message };
      }
      return { ok: true, statusCode: resp.status, data: json, error: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown fetch error";
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return { ok: false, statusCode: 0, data: null, error: lastError ?? "unknown error" };
}

async function resolveUserJwt({
  supabaseUrl,
  supabaseKey,
}) {
  const directJwt =
    process.env.BENCHMARK_USER_JWT ||
    process.env.SUPABASE_USER_JWT ||
    process.env.AUTH_USER_JWT;
  if (directJwt) return directJwt;

  const email = process.env.BENCHMARK_AUTH_EMAIL;
  const password = process.env.BENCHMARK_AUTH_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing user JWT. Set BENCHMARK_USER_JWT or BENCHMARK_AUTH_EMAIL + BENCHMARK_AUTH_PASSWORD.",
    );
  }

  const tokenEndpoint = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`;
  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !toStr(body?.access_token)) {
    const message = toStr(body?.error_description) || toStr(body?.msg) || `HTTP ${resp.status}`;
    throw new Error(`Failed to obtain user JWT via email/password: ${message}`);
  }
  return toStr(body.access_token);
}

async function resolveLiveCredentials() {
  const supabaseUrl =
    process.env.BENCHMARK_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.BENCHMARK_SUPABASE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials. Set BENCHMARK_SUPABASE_URL and BENCHMARK_SUPABASE_KEY.");
  }
  const userJwt = await resolveUserJwt({ supabaseUrl, supabaseKey });
  return { supabaseUrl, supabaseKey, userJwt };
}

async function runBenchmarks(opts) {
  const promptsPath = path.resolve(toStr(opts.prompts) || DEFAULT_PROMPTS_PATH);
  const outPath = path.resolve(toStr(opts.out) || DEFAULT_RESULTS_PATH);
  const artistKey = toStr(opts["artist-key"]) || toStr(opts.artist_key);
  const fromDate = toStr(opts.from);
  const toDate = toStr(opts.to);
  const conversationSeed = toStr(opts["conversation-seed"]) || "artist-bm";
  const limitRaw = Number(toStr(opts.limit) || "0");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;

  if (!artistKey) throw new Error("Missing required --artist-key");
  if (!fromDate || !toDate) throw new Error("Missing required --from and --to");
  if (!fs.existsSync(promptsPath)) throw new Error(`Prompts file not found: ${promptsPath}`);

  const { supabaseUrl, supabaseKey, userJwt } = await resolveLiveCredentials();

  const prompts = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
  if (!Array.isArray(prompts)) throw new Error("Prompts file must be a JSON array.");
  const selected = limit ? prompts.slice(0, limit) : prompts;
  const endpoint = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ai-insights-router-v1`;

  const rows = [];
  for (let index = 0; index < selected.length; index += 1) {
    const prompt = selected[index];
    const question = toStr(prompt?.question) || toStr(prompt?.prompt);
    const promptId = toStr(prompt?.id) || `prompt-${index + 1}`;
    if (!question) continue;

    const payload = {
      question,
      from_date: fromDate,
      to_date: toDate,
      entity_context: { artist_key: artistKey },
      conversation_id: `${conversationSeed}-${promptId}`,
    };

    const invoked = await invokeRouter({
      endpoint,
      key: supabaseKey,
      bearerToken: userJwt,
      body: payload,
      retries: 2,
    });
    const runResult = {
      prompt_id: promptId,
      question,
      context: { artist_key: artistKey, from_date: fromDate, to_date: toDate, conversation_seed: conversationSeed },
      status: invoked.ok ? "ok" : "error",
      status_code: invoked.statusCode,
      error: invoked.error,
      response: invoked.data,
    };
    const scored = scoreResult(prompt, runResult);
    rows.push(scored);
    console.log(`[${index + 1}/${selected.length}] ${promptId} -> ${scored.pass ? "PASS" : "FAIL"} score=${scored.quality_score}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} benchmark results to ${outPath}`);
  return rows;
}

function scoreResults(resultsPath, reportPath, options = {}) {
  const strict = options.strict ?? true;
  const keepHistory = options.keepHistory ?? true;
  const resolvedResultsPath = path.resolve(resultsPath || DEFAULT_RESULTS_PATH);
  const resolvedReportPath = path.resolve(reportPath || DEFAULT_REPORT_PATH);
  if (!fs.existsSync(resolvedResultsPath)) {
    console.error(`Results file not found: ${resolvedResultsPath}`);
    if (strict) process.exit(2);
    throw new Error(`Results file not found: ${resolvedResultsPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedResultsPath, "utf8"));
  if (!Array.isArray(payload)) {
    console.error("Results file must be an array.");
    if (strict) process.exit(2);
    throw new Error("Results file must be an array.");
  }

  const aggregate = aggregateResults(payload);
  renderReport(payload, aggregate, resolvedReportPath);
  if (keepHistory) writeHistory(resolvedResultsPath, resolvedReportPath);

  console.log(`Benchmark summary: ${aggregate.summary.pass_count}/${aggregate.summary.total} per-prompt pass`);
  console.log(`Median quality: ${aggregate.gate.median_quality}`);
  console.log(`Critical failures: ${aggregate.gate.critical_failure_count}`);
  console.log(`Report: ${resolvedReportPath}`);

  if (!aggregate.gate.pass) {
    console.error("Gate failed (quality+safety).");
    if (strict) process.exit(1);
    return aggregate;
  }
  console.log("Gate passed.");
  return aggregate;
}

async function runAutoloop(opts) {
  const maxRaw = Number(toStr(opts["max-iterations"]) || DEFAULT_MAX_ITERATIONS);
  const maxIterations = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : DEFAULT_MAX_ITERATIONS;
  const resultsPath = path.resolve(toStr(opts.out) || DEFAULT_RESULTS_PATH);
  const reportPath = path.resolve(toStr(opts.report) || DEFAULT_REPORT_PATH);
  let lastAggregate = null;

  for (let i = 1; i <= maxIterations; i += 1) {
    console.log(`\n=== Artist QA cycle ${i}/${maxIterations} ===`);
    await runBenchmarks(opts);
    lastAggregate = scoreResults(resultsPath, reportPath, { strict: false, keepHistory: true });
    if (lastAggregate.gate.pass) {
      console.log(`Autoloop passed on cycle ${i}.`);
      return lastAggregate;
    }
    console.log(`Autoloop cycle ${i} failed gate. Continuing...`);
  }

  if (!lastAggregate?.gate?.pass) {
    console.error(`Autoloop failed after ${maxIterations} cycles.`);
    process.exit(1);
  }
  return lastAggregate;
}

export {
  CURATED_PROMPTS,
  aggregateResults,
  scoreResult,
  clusterFailures,
};

async function main() {
  const arg = process.argv[2] ?? "generate";
  const opts = parseArgs(process.argv.slice(3));

  if (arg === "generate") {
    const outputPath = path.resolve(toStr(opts.out) || DEFAULT_PROMPTS_PATH);
    writePromptsFile(outputPath);
    return;
  }

  if (arg === "run") {
    await runBenchmarks(opts);
    return;
  }

  if (arg === "score") {
    const resultsPath = toStr(process.argv[3]) && !String(process.argv[3]).startsWith("--")
      ? process.argv[3]
      : toStr(opts.results) || DEFAULT_RESULTS_PATH;
    const reportPath = toStr(opts.report) || DEFAULT_REPORT_PATH;
    scoreResults(resultsPath, reportPath);
    return;
  }

  if (arg === "cycle") {
    await runBenchmarks(opts);
    const resultsPath = path.resolve(toStr(opts.out) || DEFAULT_RESULTS_PATH);
    const reportPath = path.resolve(toStr(opts.report) || DEFAULT_REPORT_PATH);
    scoreResults(resultsPath, reportPath);
    return;
  }

  if (arg === "autoloop") {
    await runAutoloop(opts);
    return;
  }

  console.error("Usage:");
  console.error("  node scripts/artist-benchmark.mjs generate [--out <file>]");
  console.error("  node scripts/artist-benchmark.mjs run --artist-key <key> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--prompts <file>] [--out <file>] [--conversation-seed <seed>] [--limit <n>]");
  console.error("  node scripts/artist-benchmark.mjs score [<results-file>] [--report <file>]");
  console.error("  node scripts/artist-benchmark.mjs cycle --artist-key <key> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--prompts <file>] [--out <file>] [--report <file>] [--limit <n>]");
  console.error("  node scripts/artist-benchmark.mjs autoloop --artist-key <key> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--prompts <file>] [--out <file>] [--report <file>] [--limit <n>] [--max-iterations <n>]");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
