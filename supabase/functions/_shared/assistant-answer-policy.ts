export type AnswerObjective =
  | "overall_performance"
  | "track_ranking"
  | "territory_ranking"
  | "platform_ranking"
  | "trend"
  | "recommendation"
  | "touring"
  | "ownership"
  | "entitlement"
  | "quality"
  | "general";

type AiInsightsMode = "workspace-general" | "artist" | "track";

type EntityContext = {
  track_key?: string;
  track_title?: string;
  artist_key?: string;
  artist_name?: string;
};

type Visual = {
  type?: "bar" | "line" | "table" | "none" | string;
  title?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  x?: string;
  y?: string[];
};

type Kpi = { label?: string; value?: string };

type Evidence = {
  row_count?: number;
  scanned_rows?: number;
  from_date?: string;
  to_date?: string;
  provenance?: string[];
  system_confidence?: string;
};

type BuildDecisionGradeAnswerInput = {
  question: string;
  mode: AiInsightsMode;
  resolvedEntities: EntityContext;
  visual?: Visual;
  kpis?: Kpi[];
  evidence?: Evidence;
  assistantAnswer?: string;
  assistantWhy?: string;
  qualityOutcome?: "pass" | "clarify" | "constrained" | string;
  diagnostics?: Record<string, unknown>;
};

export type DecisionGradeAnswer = {
  objective: AnswerObjective;
  executive_answer: string;
  why_this_matters: string;
  quality_outcome: "pass" | "constrained";
  data_notes: string[];
  missing_requirements: string[];
  external_context_allowed: boolean;
};

const MONEY_KEYS = [
  "net_revenue",
  "gross_revenue",
  "royalty_revenue",
  "revenue",
  "amount",
  "payable_amount",
  "estimated_payable_amount",
];

const TIME_KEYS = [
  "day_start",
  "week_start",
  "month_start",
  "quarter_start",
  "year_start",
  "period_start",
  "period_bucket",
  "date",
  "statement_month",
  "month_label",
];

const EXTERNAL_CONTEXT_PATTERN =
  /\b(benchmark|benchmarks|industry|industry trend|market trend|external context|external factors|compare to market|compare to industry|festival|festivals|venue availability|competing events?|macro)\b/i;

function toCanonicalKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s,]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferColumns(visual?: Visual): string[] {
  if (!visual) return [];
  const fromColumns = Array.isArray(visual.columns)
    ? visual.columns
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => toCanonicalKey(value))
    : [];
  const fromAxes = [visual.x, ...(Array.isArray(visual.y) ? visual.y : [])]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => toCanonicalKey(value));
  const firstRow = Array.isArray(visual.rows) ? visual.rows[0] : null;
  const fromRow = firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)
    ? Object.keys(firstRow).map((value) => toCanonicalKey(value))
    : [];
  return Array.from(new Set([...fromColumns, ...fromAxes, ...fromRow]));
}

function rowsFromVisual(visual?: Visual): Array<Record<string, unknown>> {
  return Array.isArray(visual?.rows) ? visual!.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function findMoneyKey(columns: string[]): string | null {
  for (const key of MONEY_KEYS) {
    if (columns.includes(key)) return key;
  }
  return null;
}

function findTimeKey(columns: string[]): string | null {
  for (const key of TIME_KEYS) {
    if (columns.includes(key)) return key;
  }
  return null;
}

function findTopValue(rows: Array<Record<string, unknown>>, key: string): string | null {
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function parseKpiMoney(kpis: Kpi[] | undefined): string | null {
  if (!Array.isArray(kpis)) return null;
  for (const kpi of kpis) {
    const label = typeof kpi?.label === "string" ? kpi.label.toLowerCase() : "";
    const value = typeof kpi?.value === "string" ? kpi.value.trim() : "";
    if (!value) continue;
    if (/\b(net|gross|royalty)?\s*revenue\b|\bearn(ings?)?\b|\bincome\b/.test(label)) return value;
  }
  return null;
}

function describeTerritory(codeOrName: string): string {
  const raw = codeOrName.trim();
  if (!raw) return raw;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    try {
      const display = new Intl.DisplayNames(["en"], { type: "region" }).of(upper);
      if (display && display.toUpperCase() !== upper) return `${display} (${upper})`;
    } catch {
      return upper;
    }
  }
  return raw;
}

function detectMoneyRows(
  rows: Array<Record<string, unknown>>,
  moneyKey: string | null,
): Array<Record<string, unknown>> {
  if (!moneyKey) return [];
  return [...rows]
    .filter((row) => toNum(row[moneyKey]) !== null)
    .sort((a, b) => (toNum(b[moneyKey]) ?? 0) - (toNum(a[moneyKey]) ?? 0));
}

function sumMoney(rows: Array<Record<string, unknown>>, moneyKey: string | null): number | null {
  if (!moneyKey) return null;
  const values = rows.map((row) => toNum(row[moneyKey])).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function subjectLabel(mode: AiInsightsMode, entities: EntityContext): string {
  if (mode === "track") {
    const track = entities.track_title?.trim();
    const artist = entities.artist_name?.trim();
    if (track && artist) return `"${track}" by ${artist}`;
    if (track) return `"${track}"`;
  }
  if (mode === "artist" && entities.artist_name?.trim()) return entities.artist_name.trim();
  return mode === "workspace-general" ? "the workspace" : "this scope";
}

function snapshotLabel(row: Record<string, unknown> | undefined, timeKey: string | null): string | null {
  if (!row || !timeKey) return null;
  const value = row[timeKey];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function externalContextAllowed(question: string): boolean {
  return EXTERNAL_CONTEXT_PATTERN.test(question);
}

export function inferAnswerObjective(question: string): AnswerObjective {
  const q = question.toLowerCase();
  if (/\b(tour|touring|live show|live shows|concert|venue|venues|city|cities|routing|route|booking)\b/.test(q)) {
    return "touring";
  }
  if (/\b(what is|what's|how much is)\b.*\b(getting|owed|payable|entitled|settlement)\b/.test(q)) {
    return "entitlement";
  }
  if (/\bwho owns\b|\bwho collects\b|\bregistered split\b|\bownership\b|\bsplits?\b/.test(q)) {
    return "ownership";
  }
  if (/\b(data quality|quality problems|quality blockers|confidence|conflicts|missing data|unresolved|leakage|rights ambiguity)\b/.test(q)) {
    return "quality";
  }
  if (/\b(trend|over time|month over month|quarter over quarter|week over week|changed over time)\b/.test(q)) {
    return "trend";
  }
  if (/\bwhich territories?\b|\btop territories?\b|\bmost important territor|which countr|top markets?\b/.test(q)) {
    return "territory_ranking";
  }
  if (/\bwhich platforms?\b|\btop platforms?\b|\bwhich dsps?\b|\bchannel\b/.test(q)) {
    return "platform_ranking";
  }
  if (/\bwhich tracks?\b|\btop tracks?\b|\bcarrying\b.*\brevenue\b|\bdriving\b.*\btracks?\b/.test(q)) {
    return "track_ranking";
  }
  if (/\b(what should|what do we do next|what should i do next|next step|next move|prioriti[sz]e|focus on next|manager|deserve(?:s)? .*attention|need(?:s)? .*attention|immediate attention|where should .*spend|where to spend|where should .*invest|where to invest|intervene|watch this week)\b/.test(q)) {
    return "recommendation";
  }
  if (/\b(how is|how are)\b.*\bperforming overall\b|\boverall performance\b|\bperforming overall\b|\bhow are we performing overall\b/.test(q)) {
    return "overall_performance";
  }
  return "general";
}

function buildOverallPerformanceAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const subject = subjectLabel(input.mode, input.resolvedEntities);
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const moneyRows = detectMoneyRows(rows, moneyKey);
  const top = moneyRows[0];
  const second = moneyRows[1];
  const totalFromRows = sumMoney(moneyRows, moneyKey);
  const totalFromKpi = parseKpiMoney(input.kpis);
  const totalText = totalFromKpi ?? (totalFromRows !== null ? formatMoney(totalFromRows) : null);
  const driverKey = columns.includes("track_title")
    ? "track_title"
    : columns.includes("platform")
      ? "platform"
      : columns.includes("territory")
        ? "territory"
        : columns.includes("artist_name")
          ? "artist_name"
          : null;
  const topDriverRaw = top && driverKey ? top[driverKey] : null;
  const topDriver = typeof topDriverRaw === "string"
    ? (driverKey === "territory" ? describeTerritory(topDriverRaw) : topDriverRaw)
    : null;
  const topMoney = top && moneyKey ? toNum(top[moneyKey]) : null;
  const share = totalFromRows && topMoney ? topMoney / totalFromRows : null;
  const secondDriverRaw = second && driverKey ? second[driverKey] : null;
  const secondDriver = typeof secondDriverRaw === "string"
    ? (driverKey === "territory" ? describeTerritory(secondDriverRaw) : secondDriverRaw)
    : null;

  const executiveParts: string[] = [];
  if (totalText) {
    executiveParts.push(`${subject} generated ${totalText} in the selected period.`);
  } else if (topDriver && topMoney !== null) {
    executiveParts.push(`${subject} is currently being carried by ${topDriver} at ${formatMoney(topMoney)}.`);
  } else {
    executiveParts.push(`${subject} has data in scope, but the returned result is too thin to produce a strong overall performance readout.`);
  }
  if (topDriver && topMoney !== null) {
    executiveParts.push(`${topDriver} is the clearest current revenue driver at ${formatMoney(topMoney)}.`);
  }
  if (secondDriver && second && moneyKey) {
    const secondMoney = toNum(second[moneyKey]);
    if (secondMoney !== null) executiveParts.push(`${secondDriver} is the next visible driver at ${formatMoney(secondMoney)}.`);
  }

  const why = share !== null && share >= 0.55 && topDriver
    ? `Performance is concentrated in ${topDriver}, so the immediate management decision is to defend that winner while building one secondary driver to reduce concentration risk.`
    : topDriver && secondDriver
      ? `The current picture is being led by ${topDriver} with ${secondDriver} as the next support line, which gives you a clear primary driver and a practical decision path without relying on only one asset.`
      : "The useful next move is to identify the strongest proven revenue driver and decide whether to defend it, scale it, or rebalance around a second contributor.";

  return {
    objective: "overall_performance",
    executive_answer: executiveParts.join(" "),
    why_this_matters: why,
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildTrackRankingAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const moneyRows = detectMoneyRows(rows, moneyKey).filter((row) => typeof row.track_title === "string" && row.track_title.trim().length > 0);
  const subject = subjectLabel(input.mode, input.resolvedEntities);
  if (!moneyKey || moneyRows.length === 0) {
    return {
      objective: "track_ranking",
      executive_answer: `I can't rank the tracks carrying ${subject}'s revenue from the current result because track-level revenue rows are missing.`,
      why_this_matters: "You need track_title plus a revenue metric in the same result to know which songs are actually carrying the artist or workspace.",
      quality_outcome: "constrained",
      data_notes: ["missing_track_dimension"],
      missing_requirements: ["track_title", moneyKey ?? "revenue_metric"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }
  const total = sumMoney(moneyRows, moneyKey) ?? 0;
  const topThree = moneyRows.slice(0, 3).map((row) => ({
    title: String(row.track_title),
    money: toNum(row[moneyKey]) ?? 0,
  }));
  const lead = topThree[0];
  const list = topThree.map((item) => `${item.title} (${formatMoney(item.money)})`).join(", ");
  const share = total > 0 ? lead.money / total : null;

  return {
    objective: "track_ranking",
    executive_answer: `The tracks carrying the most visible revenue are ${list}. ${lead.title} is the lead driver${share !== null ? ` at about ${formatPct(share * 100)} of the returned track-level revenue` : ""}.`,
    why_this_matters: share !== null && share >= 0.55
      ? `${lead.title} is doing disproportionate heavy lifting, so the management question is whether to defend that asset harder or build a second driver behind it.`
      : "This tells you which songs deserve protection, incremental budget, or follow-through support first.",
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildTerritoryRankingAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const territoryKey = columns.includes("territory") ? "territory" : columns.includes("top_territory") ? "top_territory" : null;
  const platformKey = columns.includes("platform") ? "platform" : columns.includes("top_platform") ? "top_platform" : null;
  if (!territoryKey || !moneyKey) {
    const platformRows = platformKey && moneyKey
      ? detectMoneyRows(rows, moneyKey).filter((row) => typeof row[platformKey] === "string")
      : [];
    const platformList = platformRows.slice(0, 2).map((row) => String(row[platformKey!])).join(" and ");
    return {
      objective: "territory_ranking",
      executive_answer: platformList
        ? `I can't rank territories from this result because the returned data is split by platform, not territory. What it does show is that ${platformList} are the strongest visible channels in the current result.`
        : "I can't rank territories from this result because the returned data does not include territory-level revenue rows.",
      why_this_matters: "Do not make market or touring decisions from a platform-only result. You need a territory split in the same query to know which countries or regions actually matter most.",
      quality_outcome: "constrained",
      data_notes: ["missing_territory_dimension"],
      missing_requirements: ["territory", moneyKey ?? "revenue_metric"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }

  const territoryRows = detectMoneyRows(rows, moneyKey).filter((row) => typeof row[territoryKey] === "string" && String(row[territoryKey]).trim().length > 0);
  if (territoryRows.length === 0) {
    return {
      objective: "territory_ranking",
      executive_answer: "I can't rank territories from this result because the territory rows returned are empty.",
      why_this_matters: "Without populated territory rows, any market recommendation would be guesswork.",
      quality_outcome: "constrained",
      data_notes: ["empty_territory_rows"],
      missing_requirements: ["territory"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }

  const topThree = territoryRows.slice(0, 3).map((row) => ({
    territory: describeTerritory(String(row[territoryKey])),
    money: toNum(row[moneyKey]) ?? 0,
  }));
  const list = topThree.map((item) => `${item.territory} (${formatMoney(item.money)})`).join(", ");

  return {
    objective: "territory_ranking",
    executive_answer: `The most important territories in the current result are ${list}. ${topThree[0].territory} is the lead market in this selected period.`,
    why_this_matters: "These are the markets to defend first, but you should still separate royalty concentration from live demand before making touring or city-routing decisions.",
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildPlatformRankingAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const platformKey = columns.includes("platform") ? "platform" : columns.includes("top_platform") ? "top_platform" : null;
  if (!platformKey || !moneyKey) {
    return {
      objective: "platform_ranking",
      executive_answer: "I can't rank platforms from this result because the returned data does not include platform-level revenue rows.",
      why_this_matters: "You need platform plus revenue in the same result to decide which DSP or channel deserves more attention.",
      quality_outcome: "constrained",
      data_notes: ["missing_platform_dimension"],
      missing_requirements: ["platform", moneyKey ?? "revenue_metric"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }
  const platformRows = detectMoneyRows(rows, moneyKey).filter((row) => typeof row[platformKey] === "string" && String(row[platformKey]).trim().length > 0);
  const topThree = platformRows.slice(0, 3).map((row) => ({
    platform: String(row[platformKey]),
    money: toNum(row[moneyKey]) ?? 0,
  }));
  return {
    objective: "platform_ranking",
    executive_answer: `The strongest platforms in the current result are ${topThree.map((item) => `${item.platform} (${formatMoney(item.money)})`).join(", ")}.`,
    why_this_matters: "This tells you where the revenue base is really concentrated before you make channel, marketing, or distribution decisions.",
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildTrendAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const timeKey = findTimeKey(columns);
  const timeRows = rows.filter((row) => timeKey && typeof row[timeKey] === "string" && String(row[timeKey]).trim().length > 0);
  if (!timeKey || !moneyKey || timeRows.length < 2) {
    const snapshotRow = timeRows[0] ?? rows[0];
    const snapshotPeriod = snapshotLabel(snapshotRow, timeKey);
    const snapshotMoney = snapshotRow && moneyKey ? toNum(snapshotRow[moneyKey]) : null;
    const snapshotText = snapshotPeriod && snapshotMoney !== null
      ? ` What I can say is that ${snapshotPeriod} shows ${formatMoney(snapshotMoney)}.`
      : "";
    return {
      objective: "trend",
      executive_answer: `I can't call this a trend from the current result because it does not include enough periods on a usable time axis.${snapshotText}`,
      why_this_matters: "A real trend answer needs multiple periods in the same result; otherwise you only have a snapshot, not direction.",
      quality_outcome: "constrained",
      data_notes: ["missing_time_dimension"],
      missing_requirements: ["time_dimension", moneyKey ?? "revenue_metric"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }

  const ordered = [...timeRows].sort((a, b) => String(a[timeKey]).localeCompare(String(b[timeKey])));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstValue = toNum(first[moneyKey]) ?? 0;
  const lastValue = toNum(last[moneyKey]) ?? 0;
  const delta = lastValue - firstValue;
  const pct = firstValue > 0 ? (delta / firstValue) * 100 : null;
  const direction = delta >= 0 ? "up" : "down";
  const pctText = pct === null ? "" : ` (${formatPct(Math.abs(pct))})`;

  return {
    objective: "trend",
    executive_answer: `The trend is ${direction}: ${String(last[timeKey])} is ${formatMoney(lastValue)} versus ${formatMoney(firstValue)} in ${String(first[timeKey])}${pctText}.`,
    why_this_matters: "This tells you whether momentum is strengthening or weakening before you change budget, release support, or cleanup priority.",
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildRecommendationAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const moneyRows = detectMoneyRows(rows, moneyKey);
  const subject = subjectLabel(input.mode, input.resolvedEntities);
  const driverKey = columns.includes("track_title")
    ? "track_title"
    : columns.includes("artist_name")
      ? "artist_name"
    : columns.includes("territory")
      ? "territory"
      : columns.includes("platform")
        ? "platform"
        : null;
  if (!moneyKey || moneyRows.length === 0 || !driverKey) {
    return {
      objective: "recommendation",
      executive_answer: `I can give a decision-grade next step for ${subject} only after the result shows the main revenue driver in a ranked dimension.`,
      why_this_matters: "A useful recommendation has to be anchored to the thing actually carrying the result: a track, territory, or platform.",
      quality_outcome: "constrained",
      data_notes: ["missing_ranked_driver_dimension"],
      missing_requirements: ["ranked_driver", moneyKey ?? "revenue_metric"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }
  const lead = moneyRows[0];
  const runnerUp = moneyRows[1];
  const leadLabelRaw = String(lead[driverKey] ?? "").trim();
  const leadLabel = driverKey === "territory" ? describeTerritory(leadLabelRaw) : leadLabelRaw;
  const total = sumMoney(moneyRows, moneyKey) ?? 0;
  const leadShare = total > 0 ? (toNum(lead[moneyKey]) ?? 0) / total : null;
  const runnerLabelRaw = runnerUp ? String(runnerUp[driverKey] ?? "").trim() : "";
  const runnerLabel = driverKey === "territory" ? describeTerritory(runnerLabelRaw) : runnerLabelRaw;

  const focusVerb = driverKey === "territory"
    ? "prioritize"
    : driverKey === "platform"
      ? "double down on"
      : driverKey === "artist_name"
        ? "give immediate attention to"
      : "protect and scale";
  const weakRows = moneyRows.filter((row) => (toNum(row[moneyKey]) ?? 0) <= 0);
  const weakLabel = weakRows[0] && driverKey ? String(weakRows[0][driverKey] ?? "").trim() : "";

  return {
    objective: "recommendation",
    executive_answer: `The next move should be to ${focusVerb} ${leadLabel}, because it is the clearest current revenue driver for ${subject}.`,
    why_this_matters: driverKey === "artist_name"
      ? `${leadLabel} needs the first operating review because it is the strongest visible artist-level revenue driver${runnerLabel ? `, with ${runnerLabel} as the next comparison point` : ""}. ${weakLabel ? `${weakLabel} also needs a separate intervention review because non-positive revenue is a different problem from scaling the winners.` : "Do not mix the winner-scaling decision with low-earner intervention; they need different actions."}`
      : leadShare !== null && leadShare >= 0.55
        ? `${leadLabel} is doing outsized work in the visible revenue mix, so the management risk is over-concentration. Defend the winner first, then fund one secondary test${runnerLabel ? ` behind ${runnerLabel}` : ""}.`
        : `The current evidence points to ${leadLabel} as the first operating priority, while still leaving room to test secondary growth without spreading effort too thin.`,
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildTouringAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const base = buildTerritoryRankingAnswer({ ...input, question: "Which territories are most important for this artist?" });
  if (base.quality_outcome === "constrained") {
    return {
      objective: "touring",
      executive_answer: "I can't shortlist touring markets from this result because there is no territory-level monetization evidence in scope.",
      why_this_matters: "Touring decisions need at least a market shortlist from internal revenue or audience data before you validate cities, venues, and promoters.",
      quality_outcome: "constrained",
      data_notes: base.data_notes,
      missing_requirements: base.missing_requirements,
      external_context_allowed: externalContextAllowed(input.question),
    };
  }

  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const moneyKey = findMoneyKey(columns);
  const territoryKey = columns.includes("territory") ? "territory" : "top_territory";
  const ranked = detectMoneyRows(rows, moneyKey).filter((row) => typeof row[territoryKey] === "string");
  const primary = ranked[0] ? describeTerritory(String(ranked[0][territoryKey])) : null;
  const secondary = ranked[1] ? describeTerritory(String(ranked[1][territoryKey])) : null;
  const shortlist = [primary, secondary].filter((value): value is string => Boolean(value));
  return {
    objective: "touring",
    executive_answer: shortlist.length >= 2
      ? `Based on royalty performance alone, start touring validation in ${shortlist[0]}, then test ${shortlist[1]} as the next market.`
      : shortlist.length === 1
        ? `Based on royalty performance alone, start touring validation in ${shortlist[0]}.`
        : "The current revenue result is not enough to shortlist touring markets.",
    why_this_matters: "Royalty concentration is only a touring proxy. Before routing shows, confirm city-level demand, ticketing strength, promoter appetite, venue availability, and local pricing resilience.",
    quality_outcome: shortlist.length > 0 ? "pass" : "constrained",
    data_notes: [],
    missing_requirements: shortlist.length > 0 ? [] : ["territory"],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildOwnershipAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const hasParty = columns.includes("party_name");
  const hasShare = columns.includes("share_pct");
  if (!hasParty || !hasShare || rows.length === 0) {
    return {
      objective: "ownership",
      executive_answer: "I can't answer ownership from the current result because the returned rows do not include party and share information together.",
      why_this_matters: "Ownership answers must be tied to named parties and explicit shares, not inferred from unrelated revenue rows.",
      quality_outcome: "constrained",
      data_notes: ["missing_ownership_fields"],
      missing_requirements: ["party_name", "share_pct"],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }
  const ranked = [...rows]
    .map((row) => ({
      party: String(row.party_name ?? "").trim(),
      share: toNum(row.share_pct) ?? 0,
      basis: typeof row.basis_type === "string" ? row.basis_type.trim() : "",
    }))
    .filter((row) => row.party.length > 0)
    .sort((a, b) => b.share - a.share);
  const list = ranked.slice(0, 3).map((item) => `${item.party} (${formatPct(item.share)})`).join(", ");
  const basis = ranked.find((item) => item.basis.length > 0)?.basis ?? "registered";
  return {
    objective: "ownership",
    executive_answer: `Based on the rights rows returned, ownership is currently shown as ${list}.`,
    why_this_matters: `This appears to be ${basis} split data, which is useful for ownership context but not the same thing as a contractual payout calculation.`,
    quality_outcome: "pass",
    data_notes: [],
    missing_requirements: [],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildEntitlementAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const payableKey = columns.includes("payable_amount")
    ? "payable_amount"
    : columns.includes("estimated_payable_amount")
      ? "estimated_payable_amount"
      : null;
  if (payableKey) {
    const first = rows[0];
    const amount = first ? toNum(first[payableKey]) : null;
    return {
      objective: "entitlement",
      executive_answer: amount !== null
        ? `The current result estimates a payable amount of ${formatMoney(amount)} for this question.`
        : "The current result includes a payable field, but it is empty.",
      why_this_matters: "This answer is only as reliable as the linked agreement logic and the evidence attached to the payable calculation.",
      quality_outcome: amount !== null ? "pass" : "constrained",
      data_notes: amount !== null ? [] : ["empty_payable_amount"],
      missing_requirements: amount !== null ? [] : [payableKey],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }

  const observedMoneyKey = findMoneyKey(columns);
  const observedMoney = rows[0] && observedMoneyKey ? toNum(rows[0][observedMoneyKey]) : null;
  const registeredShare = rows[0] && columns.includes("share_pct") ? toNum(rows[0].share_pct) : null;
  const shareText = registeredShare !== null ? ` Registered share in the returned row is ${formatPct(registeredShare)}.` : "";
  const moneyText = observedMoney !== null ? ` Observed money in scope is ${formatMoney(observedMoney)}.` : "";

  return {
    objective: "entitlement",
    executive_answer: `I can't give an exact payout from the current data because the contract terms needed to turn revenue into a writer payment are missing.${moneyText}${shareText}`,
    why_this_matters: "Registered shares and observed income are useful context, but exact payout requires contract logic, effective dates, and any applicable deductions or administration terms.",
    quality_outcome: "constrained",
    data_notes: ["missing_contract_terms"],
    missing_requirements: ["contract_terms"],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildQualityAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const rows = rowsFromVisual(input.visual);
  const columns = inferColumns(input.visual);
  const first = rows[0] ?? {};
  const failed = columns.includes("failed_line_count") ? toNum(first.failed_line_count) : null;
  const tasks = columns.includes("open_critical_task_count") ? toNum(first.open_critical_task_count) : null;
  const missingFields = Array.isArray(input.diagnostics?.missing_fields)
    ? input.diagnostics!.missing_fields!.filter((value): value is string => typeof value === "string")
    : [];
  const detail: string[] = [];
  if (failed !== null) detail.push(`${Math.round(failed)} failed lines`);
  if (tasks !== null) detail.push(`${Math.round(tasks)} open critical review tasks`);
  if (missingFields.length > 0) detail.push(`missing fields: ${missingFields.join(", ")}`);
  return {
    objective: "quality",
    executive_answer: detail.length > 0
      ? `The main confidence blockers in the current result are ${detail.join(", ")}.`
      : "The current result does not expose enough quality metadata to diagnose the confidence blockers precisely.",
    why_this_matters: "Quality issues distort performance analysis, hide leakage, and make rights or payout answers less trustworthy.",
    quality_outcome: detail.length > 0 ? "pass" : "constrained",
    data_notes: detail.length > 0 ? [] : ["missing_quality_fields"],
    missing_requirements: detail.length > 0 ? [] : ["quality_metadata"],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

function buildGeneralAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const assistantAnswer = typeof input.assistantAnswer === "string" ? input.assistantAnswer.trim() : "";
  const assistantWhy = typeof input.assistantWhy === "string" ? input.assistantWhy.trim() : "";
  const subject = subjectLabel(input.mode, input.resolvedEntities);
  if (assistantAnswer.length > 0) {
    return {
      objective: "general",
      executive_answer: assistantAnswer,
      why_this_matters: assistantWhy || `This answer is anchored to ${subject} and the current data in scope.`,
      quality_outcome: "pass",
      data_notes: [],
      missing_requirements: [],
      external_context_allowed: externalContextAllowed(input.question),
    };
  }
  return {
    objective: "general",
    executive_answer: `I have data in scope for ${subject}, but I need a stronger result shape to answer this question well.`,
    why_this_matters: "The answer layer should degrade honestly rather than invent a confident narrative from weak evidence.",
    quality_outcome: "constrained",
    data_notes: ["weak_general_answer"],
    missing_requirements: ["question_specific_evidence"],
    external_context_allowed: externalContextAllowed(input.question),
  };
}

export function buildDecisionGradeAnswer(input: BuildDecisionGradeAnswerInput): DecisionGradeAnswer {
  const objective = inferAnswerObjective(input.question);
  if (objective === "overall_performance") return buildOverallPerformanceAnswer(input);
  if (objective === "track_ranking") return buildTrackRankingAnswer(input);
  if (objective === "territory_ranking") return buildTerritoryRankingAnswer(input);
  if (objective === "platform_ranking") return buildPlatformRankingAnswer(input);
  if (objective === "trend") return buildTrendAnswer(input);
  if (objective === "recommendation") return buildRecommendationAnswer(input);
  if (objective === "touring") return buildTouringAnswer(input);
  if (objective === "ownership") return buildOwnershipAnswer(input);
  if (objective === "entitlement") return buildEntitlementAnswer(input);
  if (objective === "quality") return buildQualityAnswer(input);
  return buildGeneralAnswer(input);
}
