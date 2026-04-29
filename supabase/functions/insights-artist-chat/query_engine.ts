export type CatalogColumn = {
  field_key: string;
  inferred_type: "text" | "number" | "date" | string;
  coverage_pct: number;
  sample_values: unknown[];
  source: "canonical" | "custom";
  aliases: string[];
};

export type ArtistCatalog = {
  total_rows: number;
  columns: CatalogColumn[];
  aliases: Record<string, string[]>;
};

export type AnalysisPlan = {
  intent: string;
  metrics: string[];
  dimensions: string[];
  filters: Array<{ column: string; op: "=" | "in" | "contains"; value: string | string[] }>;
  grain: "none" | "day" | "week" | "month" | "quarter";
  time_window: "explicit" | "implicit";
  confidence: "high" | "medium" | "low";
  required_columns: string[];
  top_n: number;
  sort_by: string;
  sort_dir: "asc" | "desc";
};

export type VerifierStatus = {
  status: "passed" | "failed";
  reason?: string;
  checks: string[];
  warnings?: string[];
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isSafeSqlIdentifier(value: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(value);
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
}

export function buildAliasLookup(catalog: ArtistCatalog): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of catalog.columns) {
    map.set(normalizeToken(col.field_key), col.field_key);
    for (const alias of col.aliases ?? []) map.set(normalizeToken(alias), col.field_key);
  }
  return map;
}

export function buildCatalog(input: unknown): ArtistCatalog {
  const empty: ArtistCatalog = { total_rows: 0, columns: [], aliases: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) return empty;
  const root = input as Record<string, unknown>;

  const totalRowsRaw = typeof root.total_rows === "number" ? root.total_rows : Number(root.total_rows ?? 0);
  const total_rows = Number.isFinite(totalRowsRaw) ? totalRowsRaw : 0;

  const aliases: Record<string, string[]> = {};
  if (root.aliases && typeof root.aliases === "object" && !Array.isArray(root.aliases)) {
    for (const [k, v] of Object.entries(root.aliases as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      aliases[k] = v.filter((x) => typeof x === "string").map((x) => (x as string).trim()).filter(Boolean);
    }
  }

  const columnsRaw = Array.isArray(root.columns) ? root.columns : [];
  const columns: CatalogColumn[] = columnsRaw
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const field_key = typeof row.field_key === "string" ? row.field_key.trim() : "";
      if (!field_key) return null;
      const inferred = typeof row.inferred_type === "string" ? row.inferred_type : "text";
      const coverage = typeof row.coverage_pct === "number" ? row.coverage_pct : Number(row.coverage_pct ?? 0);
      const source = row.source === "custom" ? "custom" : "canonical";
      const sample_values = Array.isArray(row.sample_values) ? row.sample_values.slice(0, 5) : [];
      const fromAliases = aliases[field_key] ?? [];
      return {
        field_key,
        inferred_type: inferred,
        coverage_pct: Number.isFinite(coverage) ? coverage : 0,
        sample_values,
        source,
        aliases: fromAliases,
      } satisfies CatalogColumn;
    })
    .filter((item): item is CatalogColumn => !!item);

  return { total_rows, columns, aliases };
}

/**
 * Resolve a requested column name to the best matching field_key in the catalog.
 * Resolution order:
 *   1. Exact field_key match
 *   2. Alias match (via catalog.aliases)
 *   3. Normalized token match (via buildAliasLookup)
 *   4. Prefix / contains match on field_key tokens
 * Returns null if no reasonable match is found.
 */
export function resolveColumnByAlias(
  requestedName: string,
  catalog: ArtistCatalog,
): string | null {
  const byKey = new Map(catalog.columns.map((c) => [c.field_key, c] as const));

  // 1. Exact match
  if (byKey.has(requestedName)) return requestedName;

  // 2. Alias lookup (full alias map)
  const aliasLookup = buildAliasLookup(catalog);
  const normalized = normalizeToken(requestedName);
  const aliasHit = aliasLookup.get(normalized);
  if (aliasHit && byKey.has(aliasHit)) return aliasHit;

  // 3. Partial token match — any catalog field_key that contains the requested token(s)
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
  for (const col of catalog.columns) {
    const colNorm = normalizeToken(col.field_key);
    if (tokens.some((t) => colNorm.includes(t))) return col.field_key;
    // Also check aliases
    for (const alias of col.aliases ?? []) {
      const aliasNorm = normalizeToken(alias);
      if (tokens.some((t) => aliasNorm.includes(t))) return col.field_key;
    }
  }

  return null;
}

function tokenizeQuestion(question: string): string[] {
  return unique(normalizeToken(question).split(/\s+/).filter(Boolean));
}

function inferConfidence(hitCount: number): "high" | "medium" | "low" {
  if (hitCount >= 4) return "high";
  if (hitCount >= 2) return "medium";
  return "low";
}

function inferTopN(question: string): number {
  const explicit = question.match(/\b(top|highest|best|first)\s+(\d{1,3})\b/i);
  if (explicit) {
    const parsed = Number(explicit[2]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(50, parsed);
  }
  const standalone = question.match(/\b(\d{1,3})\s+(tracks?|songs?|items?)\b/i);
  if (standalone) {
    const parsed = Number(standalone[1]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(50, parsed);
  }
  return 5;
}

type ComparisonUnit = "day" | "week" | "month" | "quarter" | "year";
type ComparisonWindow = { amount: number; unit: ComparisonUnit };
type ExplicitYearComparison = { years: number[] };

function unitAliasToCanonical(value: string | null | undefined): ComparisonUnit | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (v.startsWith("day")) return "day";
  if (v.startsWith("week")) return "week";
  if (v.startsWith("month")) return "month";
  if (v.startsWith("quarter")) return "quarter";
  if (v.startsWith("year") || v === "yr" || v === "yrs") return "year";
  return null;
}

function parseAmountToken(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "a" || v === "an" || v === "one") return 1;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

function parseWindowUnitAndAmount(amountToken: string | null | undefined, unitToken: string | null | undefined): ComparisonWindow | null {
  const amount = parseAmountToken(amountToken);
  const unit = unitAliasToCanonical(unitToken);
  if (!amount || !unit) return null;
  return { amount, unit };
}

export function parseRelativeWindow(question: string): ComparisonWindow | null {
  const q = question.toLowerCase();
  const direct = q.match(/\b(?:last|past)\s+(\d{1,3}|one|a|an)\s+(days?|weeks?|months?|quarters?|years?)\b/i);
  if (direct) {
    const parsed = parseWindowUnitAndAmount(direct[1], direct[2]);
    if (parsed) return parsed;
  }

  const thisWindow = q.match(/\bthis\s+(day|week|month|quarter|year)\b/i);
  if (thisWindow) {
    const unit = unitAliasToCanonical(thisWindow[1]);
    if (unit) return { amount: 1, unit };
  }

  return null;
}

function parseComparisonWindow(question: string): ComparisonWindow | null {
  const q = question.toLowerCase();
  const direct = q.match(
    /\b(?:last|past)\s+(\d{1,3}|one|a|an)\s+(days?|weeks?|months?|quarters?|years?)\s+(?:vs|versus|compared to)\s+(?:prior|previous)\s*(\d{0,3}|one|a|an)?\s*(days?|weeks?|months?|quarters?|years?)?\b/i,
  );
  if (direct) {
    const parsed = parseWindowUnitAndAmount(direct[1], direct[2]);
    if (parsed) return parsed;
  }

  const fallback = q.match(/\b(?:last|past)\s+(\d{1,3}|one|a|an)\s+(days?|weeks?|months?|quarters?|years?)\b/i);
  if (fallback && /\b(compare|comparison|vs|versus|prior|previous)\b/i.test(q)) {
    const parsed = parseWindowUnitAndAmount(fallback[1], fallback[2]);
    if (parsed) return parsed;
  }

  const implicitYearCompare = q.match(/\b(?:last|past)\s+year\b/) &&
    /\b(compare|comparison|vs|versus|prior|previous)\b/i.test(q);
  if (implicitYearCompare) {
    return { amount: 1, unit: "year" };
  }
  return null;
}

function parseExplicitYearComparison(question: string): ExplicitYearComparison | null {
  if (!/\b(compare|comparison|vs|versus|to|against)\b/i.test(question)) return null;
  const years = Array.from(question.matchAll(/\b(20\d{2}|19\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1900 && year <= 2100);
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => a - b);
  return uniqueYears.length >= 2 ? { years: uniqueYears.slice(0, 4) } : null;
}

function detectTrendGrain(question: string): AnalysisPlan["grain"] {
  const q = question.toLowerCase();
  if (/\b(day by day|daily|per day)\b/.test(q)) return "day";
  if (/\b(week by week|weekly|per week|week over week|wow)\b/.test(q)) return "week";
  if (/\b(month by month|monthly|per month|month over month|mom)\b/.test(q)) return "month";
  if (/\b(quarter by quarter|quarterly|per quarter|quarter over quarter|qoq)\b/.test(q)) return "quarter";
  if (/\b(year by year|yearly|annual|annually|per year|year over year|yoy)\b/.test(q)) return "quarter";
  if (/\bweek\b/.test(q)) return "week";
  if (/\bday\b/.test(q)) return "day";
  if (/\bquarter\b/.test(q)) return "quarter";
  return "month";
}

function intervalOffsetSql(amount: number, unit: ComparisonUnit): string {
  const n = Math.max(1, Math.min(365, Math.round(amount)));
  if (unit === "day") return `${n} * INTERVAL '1 day'`;
  if (unit === "week") return `${n} * INTERVAL '1 week'`;
  if (unit === "month") return `${n} * INTERVAL '1 month'`;
  if (unit === "quarter") return `${n * 3} * INTERVAL '1 month'`;
  return `${n} * INTERVAL '1 year'`;
}

export function deriveAnalysisPlanFallback(question: string, catalog: ArtistCatalog): AnalysisPlan {
  const q = question.toLowerCase();
  const tokens = tokenizeQuestion(question);
  const aliasLookup = buildAliasLookup(catalog);
  const selectedColumns: string[] = [];

  for (const t of tokens) {
    const hit = aliasLookup.get(t);
    if (hit) selectedColumns.push(hit);
  }

  const normalizedQuestion = normalizeToken(question);
  for (const [alias, field] of aliasLookup.entries()) {
    if (alias.length < 4) continue;
    if (normalizedQuestion.includes(alias)) selectedColumns.push(field);
  }

  const hasField = (...names: string[]): boolean => catalog.columns.some((c) => names.includes(c.field_key));
  const firstAvailable = (...names: string[]): string | null =>
    names.find((name) => hasField(name)) ?? null;

  const asksAttention = /\b(deserve|attention|immediate|prioriti[sz]e|priority|watchlist|focus)\b/i.test(q);
  const asksArtistRanking = /\bartists?\b|\bartistes?\b/i.test(q) && asksAttention;
  const asksTouring = /\b(tour|touring|show|venue|city|route|routing)\b/i.test(q);
  const asksRevenue = /\b(revenu\w*|money|earning|royalt|gross|net)\b/i.test(q) || asksAttention || asksTouring;
  const asksPlatform = /\b(platform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer)\b/i.test(q);
  const asksTerritory = /\b(territory|country|market|region|geo|geography)\b/i.test(q) || asksTouring;
  const asksTrend = /\b(trend|over time|qoq|yoy|mom|growth rate|month over month|quarter over quarter|week over week|month by month|week by week|day by day|quarter by quarter|last\s+\d+\s+(?:days?|weeks?|months?|quarters?)|prior\s+\d+\s+(?:days?|weeks?|months?|quarters?)|vs\s+prior|compared\s+to\s+prior)\b/i.test(q);
  const explicitYearComparison = parseExplicitYearComparison(question);
  const comparisonWindow = parseComparisonWindow(question);
  const relativeWindow = parseRelativeWindow(question);
  const asksPeriodComparison = explicitYearComparison !== null || comparisonWindow !== null || /\b(compare|comparison|vs\s+prior|versus\s+prior|compared\s+to\s+prior)\b/i.test(q);
  const asksOpportunityRisk = /\b(opportunity|potential)\b.*\b(risk|data risk|quality risk)\b|\b(highest opportunity)\b.*\b(highest data risk)\b/i.test(q);
  const asksHighestOpportunity = /\b(highest opportunity|top opportunity|best opportunity|tracks? with highest opportunity)\b/i.test(q);
  const asksGrossNetGap = /\b(gross[\s-]*to[\s-]*net|gross\s*-\s*net|gap)\b/i.test(q) &&
    /\b(gross|net|revenue|payout|leakage|leak)\b/i.test(q);
  const asksConfidenceRisk = /\b(confidence risk|mapping|validation|low confidence|high confidence|quality issue|quality risk|attribution|rights|rights-related|payout leak|payout leakage|leakage)\b/i.test(q);
  const asksRightsLeakage = /\b(rights|rights type|royalty rate|payout leakage|leakage|contract issue|effective royalty)\b/i.test(q);
  const asksOwnership = (
    /\b(owner|owns|ownership|split|splits|share|shares|rightsholder|publisher|writer|admin|collection|collect(?:s|ion|ed)?|ipi|cae)\b/i.test(q) &&
    /\b(work|song|track|recording|composition|catalog|rights?)\b/i.test(q)
  ) || /\bwho owns\b/i.test(q);
  const asksEntitlement = (
    /\b(owed|payable|entitlement|payout|pay[-\s]?out|getting from|earning from|earning on|paid from|what is .* getting)\b/i.test(q) &&
    /\b(writer|publisher|artist|owner|payee|song|work|track|recording)\b/i.test(q)
  );
  const asksPoor = /\b(poor|worst|lowest|underperform|bottom)\b/i.test(q);
  const asksStrategyAllocation = /\b(focus|strategy|priorit|budget|no-regret|what should|next step|allocate)\b/i.test(q);
  const rightsDimensionField = firstAvailable("work_title", "recording_title", "track_title");
  const rightsStreamField = firstAvailable("rights_stream", "rights_type", "rights_family");

  const dimensions: string[] = [];
  if (asksArtistRanking && hasField("artist_name")) dimensions.push("artist_name");
  if (asksPlatform) dimensions.push("platform");
  if (asksTerritory) dimensions.push("territory");
  if (asksRightsLeakage) dimensions.push("rights_type");
  if (/\b(rights|rights[-\s]?type|royalty type)\b/i.test(q)) dimensions.push("rights_type");
  if (asksTrend && !asksPeriodComparison) dimensions.push("event_date");
  if (asksOwnership || asksEntitlement) {
    dimensions.push("party_name");
    if (rightsDimensionField) dimensions.push(rightsDimensionField);
    if (rightsStreamField) dimensions.push(rightsStreamField);
    if (hasField("share_kind")) dimensions.push("share_kind");
    if (hasField("basis_type")) dimensions.push("basis_type");
  }
  // For "underperforming / worst" track questions, group by track
  if (asksPoor && !dimensions.includes("track_title")) dimensions.push("track_title");

  const metrics: string[] = [];
  if (asksRevenue) {
    if (catalog.columns.some((c) => c.field_key === "net_revenue")) metrics.push("net_revenue");
    else if (catalog.columns.some((c) => c.field_key === "gross_revenue")) metrics.push("gross_revenue");
  }
  if ((asksOwnership || asksEntitlement) && hasField("share_pct")) metrics.push("share_pct");
  if ((asksOwnership || asksEntitlement) && hasField("confidence")) metrics.push("confidence");
  if (metrics.length === 0 && catalog.columns.some((c) => c.field_key === "quantity")) metrics.push("quantity");

  const inferredFromAliases = unique(selectedColumns.filter((c) => c !== "event_date"));
  for (const col of inferredFromAliases) {
    if (catalog.columns.some((x) => x.field_key === col && x.inferred_type === "number")) metrics.push(col);
    if (catalog.columns.some((x) => x.field_key === col && x.inferred_type !== "number")) dimensions.push(col);
  }

  // When question is about track performance but no dimension yet, add track_title
  if (!dimensions.includes("track_title") && /\b(track|song|title)\b/i.test(q)) {
    dimensions.push("track_title");
  }
  if (asksHighestOpportunity && !dimensions.includes("track_title")) dimensions.push("track_title");
  if (asksRightsLeakage && !dimensions.includes("platform")) dimensions.push("platform");
  if (asksRightsLeakage && !dimensions.includes("territory")) dimensions.push("territory");
  if (asksStrategyAllocation && dimensions.length === 0) {
    dimensions.push("track_title");
  }

  const required_columns = unique([
    ...dimensions,
    ...metrics,
    ...(asksPlatform ? ["platform"] : []),
    ...(asksRevenue ? [metrics[0] ?? "net_revenue"] : []),
    ...(asksTrend && !asksPeriodComparison ? ["event_date"] : []),
    ...(asksOpportunityRisk ? ["track_title", "net_revenue", "mapping_confidence", "validation_status"] : []),
    ...(asksHighestOpportunity ? ["track_title", "net_revenue", "mapping_confidence", "validation_status"] : []),
    ...(asksGrossNetGap ? ["gross_revenue", "net_revenue"] : []),
    ...(asksConfidenceRisk ? ["mapping_confidence", "validation_status", "gross_revenue", "net_revenue"] : []),
    ...(asksRightsLeakage ? ["rights_type", "net_revenue", "gross_revenue"] : []),
    ...(asksOwnership ? ["party_name", "share_pct", "share_kind", "basis_type"] : []),
    ...(asksOwnership && rightsDimensionField ? [rightsDimensionField] : []),
    ...(asksEntitlement ? ["party_name", "share_pct", "share_kind", "basis_type"] : []),
    ...(asksEntitlement && rightsDimensionField ? [rightsDimensionField] : []),
  ]);
  const planFilters: AnalysisPlan["filters"] = [];
  if (explicitYearComparison) {
    planFilters.push({
      column: "__year_compare__",
      op: "=",
      value: explicitYearComparison.years.join(","),
    });
  } else if (comparisonWindow) {
    planFilters.push({
      column: "__period_compare__",
      op: "=",
      value: `${comparisonWindow.amount}:${comparisonWindow.unit}`,
    });
  } else if (relativeWindow) {
    planFilters.push({
      column: "__relative_window__",
      op: "=",
      value: `${relativeWindow.amount}:${relativeWindow.unit}`,
    });
  }

  const intent = asksPeriodComparison
    ? "period_comparison"
    : asksEntitlement
    ? "entitlement_estimation"
    : asksOwnership
    ? "rights_ownership"
    : asksGrossNetGap
    ? "gap_analysis"
    : asksRightsLeakage
    ? "rights_leakage"
    : asksConfidenceRisk
    ? "quality_risk_impact"
    : asksOpportunityRisk || asksHighestOpportunity
    ? "opportunity_risk_tracks"
    : asksPlatform
      ? "platform_analysis"
      : asksTerritory
        ? "territory_analysis"
        : asksTrend
          ? "trend_analysis"
          : asksRevenue
            ? "revenue_analysis"
            : "exploratory_analysis";

  const grain = asksPeriodComparison
    ? "none"
    : asksTrend
    ? detectTrendGrain(question)
    : "none";

  // For "poor/worst" questions sort ascending, otherwise desc
  const sortDir = asksPoor ? "asc" : "desc";

  return {
    intent,
    metrics: unique([
      ...metrics,
      ...(asksGrossNetGap ? ["gross_revenue", "net_revenue"] : []),
      ...(asksConfidenceRisk ? ["gross_revenue", "net_revenue", "mapping_confidence"] : []),
      ...(asksRightsLeakage ? ["gross_revenue", "net_revenue"] : []),
      ...(asksOwnership || asksEntitlement ? ["share_pct"] : []),
    ]).slice(0, 3),
    dimensions: unique(dimensions).slice(0, 3),
    filters: planFilters,
    grain,
    time_window: "implicit",
    confidence: inferConfidence(required_columns.length),
    required_columns,
    top_n: inferTopN(question),
    sort_by: asksGrossNetGap
      ? "gross_net_gap_abs"
      : asksOwnership || asksEntitlement
      ? "share_pct"
      : asksOpportunityRisk
      ? "opportunity_score"
      : (metrics[0] ?? "net_revenue"),
    sort_dir: sortDir,
  };
}

function buildDimensionExpr(column: CatalogColumn, grain: AnalysisPlan["grain"]): string {
  const key = column.field_key;
  if (key === "event_date" && grain !== "none") {
    if (grain === "day") return "date_trunc('day', r.event_date)::date AS day_start";
    if (grain === "week") return "date_trunc('week', r.event_date)::date AS week_start";
    if (grain === "quarter") return "date_trunc('quarter', r.event_date)::date AS quarter_start";
    return "date_trunc('month', r.event_date)::date AS month_start";
  }
  return `r.${key} AS ${key}`;
}

function buildMetricExpr(column: CatalogColumn): string {
  const key = column.field_key;
  if (column.source === "canonical") return `SUM(COALESCE(r.${key}, 0))::numeric AS ${key}`;
  return `SUM(COALESCE(NULLIF(regexp_replace(r.${key}::text, '[^0-9\\.\\-]', '', 'g'), '')::numeric, 0))::numeric AS ${key}`;
}

function buildRowEnrichedCte(customFields: string[]): string {
  const normalized = unique(customFields).filter((field) => isSafeSqlIdentifier(field));
  const customProjection = normalized
    .map(
      (field) =>
        `(SELECT sc.custom_value FROM scoped_custom sc WHERE sc.report_id = c.report_id AND sc.source_row_id = c.source_row_id AND sc.event_date = c.event_date AND lower(sc.custom_key) = lower(${quoteSqlLiteral(field)}) LIMIT 1) AS ${field}`,
    )
    .join(",\n        ");
  const projection = customProjection.length > 0 ? `,\n        ${customProjection}` : "";
  return `WITH row_enriched AS (
      SELECT c.*${projection}
      FROM scoped_core c
    )`;
}

function resolveCatalogColumns(names: string[], catalog: ArtistCatalog, byKey: Map<string, CatalogColumn>): CatalogColumn[] {
  const result: CatalogColumn[] = [];
  for (const name of unique(names)) {
    const direct = byKey.get(name);
    if (direct) {
      result.push(direct);
      continue;
    }
    const resolved = resolveColumnByAlias(name, catalog);
    if (resolved && byKey.has(resolved)) result.push(byKey.get(resolved)!);
  }
  return result;
}

function sourceKindFilterSql(intent: AnalysisPlan["intent"], byKey: Map<string, CatalogColumn>): string | null {
  if (!byKey.has("source_kind")) return null;
  if ([
    "revenue_analysis",
    "platform_analysis",
    "territory_analysis",
    "trend_analysis",
    "gap_analysis",
    "quality_risk_impact",
    "period_comparison",
    "opportunity_risk_tracks",
    "rights_leakage",
  ].includes(intent)) {
    return "lower(COALESCE(r.source_kind, '')) IN ('income', 'legacy_income')";
  }
  if (intent === "rights_ownership") {
    return "lower(COALESCE(r.source_kind, '')) IN ('rights', 'entitlement')";
  }
  if (intent === "entitlement_estimation") {
    return "lower(COALESCE(r.source_kind, '')) IN ('entitlement', 'rights')";
  }
  return null;
}

export function compileSqlFromPlan(plan: AnalysisPlan, catalog: ArtistCatalog): { sql: string; chosen_columns: string[] } {
  const byKey = new Map(catalog.columns.map((c) => [c.field_key, c] as const));

  if (plan.intent === "rights_ownership") {
    const dims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 5);
    if (!dims.some((d) => d.field_key === "party_name") && byKey.has("party_name")) dims.unshift(byKey.get("party_name")!);
    if (!dims.some((d) => d.field_key === "work_title") && byKey.has("work_title")) dims.push(byKey.get("work_title")!);
    else if (!dims.some((d) => d.field_key === "recording_title") && byKey.has("recording_title")) dims.push(byKey.get("recording_title")!);
    if (!dims.some((d) => d.field_key === "rights_stream") && byKey.has("rights_stream")) dims.push(byKey.get("rights_stream")!);
    if (!dims.some((d) => d.field_key === "share_kind") && byKey.has("share_kind")) dims.push(byKey.get("share_kind")!);
    if (!dims.some((d) => d.field_key === "basis_type") && byKey.has("basis_type")) dims.push(byKey.get("basis_type")!);
    const rowEnrichedCte = buildRowEnrichedCte(dims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const dimAliases = dims.map((d) => d.field_key);
    const dimSelect = dims.map((d) => `r.${d.field_key} AS ${d.field_key}`).join(",\n      ");
    const dimWithComma = dimSelect.length > 0 ? `${dimSelect},\n      ` : "";
    const groupBy = dimAliases.length > 0 ? `GROUP BY ${dimAliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = sourceFilter ? `WHERE ${sourceFilter}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 10)));
    const sql = `${rowEnrichedCte}
    SELECT
      ${dimWithComma}MAX(COALESCE(r.share_pct, 0))::numeric AS share_pct,
      MAX(COALESCE(r.confidence, 0))::numeric AS confidence,
      BOOL_OR(COALESCE(r.is_conflicted, false)) AS is_conflicted
    FROM row_enriched r
    ${whereSql}
    ${groupBy}
    ORDER BY share_pct DESC NULLS LAST, confidence DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: [...dimAliases, "share_pct", "confidence", "is_conflicted"],
    };
  }

  if (plan.intent === "entitlement_estimation") {
    const dims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 5);
    if (!dims.some((d) => d.field_key === "party_name") && byKey.has("party_name")) dims.unshift(byKey.get("party_name")!);
    if (!dims.some((d) => d.field_key === "work_title") && byKey.has("work_title")) dims.push(byKey.get("work_title")!);
    else if (!dims.some((d) => d.field_key === "recording_title") && byKey.has("recording_title")) dims.push(byKey.get("recording_title")!);
    if (!dims.some((d) => d.field_key === "rights_stream") && byKey.has("rights_stream")) dims.push(byKey.get("rights_stream")!);
    if (!dims.some((d) => d.field_key === "share_kind") && byKey.has("share_kind")) dims.push(byKey.get("share_kind")!);
    if (!dims.some((d) => d.field_key === "basis_type") && byKey.has("basis_type")) dims.push(byKey.get("basis_type")!);
    const rowEnrichedCte = buildRowEnrichedCte(dims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const dimAliases = dims.map((d) => d.field_key);
    const dimSelect = dims.map((d) => `r.${d.field_key} AS ${d.field_key}`).join(",\n        ");
    const dimProjection = dimSelect.length > 0 ? `${dimSelect},\n        ` : "";
    const groupBy = dimAliases.length > 0 ? `GROUP BY ${dimAliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = sourceFilter ? `WHERE ${sourceFilter}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 10)));
    const sql = `${rowEnrichedCte},
    entitlement_rollup AS (
      SELECT
        ${dimProjection}MAX(COALESCE(r.share_pct, 0))::numeric AS share_pct,
        MAX(COALESCE(r.confidence, 0))::numeric AS confidence,
        BOOL_OR(COALESCE(r.is_conflicted, false)) AS is_conflicted,
        MAX(
          CASE
            WHEN lower(COALESCE(r.share_kind, '')) = 'payable' THEN 3
            WHEN lower(COALESCE(r.basis_type, '')) = 'estimated' THEN 2
            WHEN lower(COALESCE(r.share_kind, '')) = 'registered' THEN 1
            ELSE 0
          END
        ) AS payable_rank
      FROM row_enriched r
      ${whereSql}
      ${groupBy}
    )
    SELECT
      ${dimAliases.join(",\n      ")}${dimAliases.length > 0 ? ",\n      " : ""}share_pct,
      confidence,
      is_conflicted
    FROM entitlement_rollup
    ORDER BY payable_rank DESC, share_pct DESC NULLS LAST, confidence DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: [...dimAliases, "share_pct", "confidence", "is_conflicted"],
    };
  }

  if (plan.intent === "gap_analysis") {
    const dims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 3);
    const rowEnrichedCte = buildRowEnrichedCte(dims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const dimSelect = dims.map((d) => `r.${d.field_key} AS ${d.field_key}`).join(",\n      ");
    const dimAliases = dims.map((d) => d.field_key);
    const dimWithComma = dimSelect.length > 0 ? `${dimSelect},\n      ` : "";
    const groupBy = dimAliases.length > 0 ? `GROUP BY ${dimAliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = sourceFilter ? `WHERE ${sourceFilter}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 10)));
    const sql = `${rowEnrichedCte}
    SELECT
      ${dimWithComma}SUM(COALESCE(r.gross_revenue, 0))::numeric AS gross_revenue,
      SUM(COALESCE(r.net_revenue, 0))::numeric AS net_revenue,
      (SUM(COALESCE(r.gross_revenue, 0)) - SUM(COALESCE(r.net_revenue, 0)))::numeric AS gross_net_gap_abs,
      CASE
        WHEN SUM(COALESCE(r.gross_revenue, 0)) = 0 THEN NULL
        ELSE ((SUM(COALESCE(r.gross_revenue, 0)) - SUM(COALESCE(r.net_revenue, 0))) / NULLIF(SUM(COALESCE(r.gross_revenue, 0)), 0))::numeric
      END AS gross_net_gap_pct
    FROM row_enriched r
    ${whereSql}
    ${groupBy}
    ORDER BY gross_net_gap_abs DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: [...dimAliases, "gross_revenue", "net_revenue", "gross_net_gap_abs", "gross_net_gap_pct"],
    };
  }

  if (plan.intent === "quality_risk_impact") {
    const dims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 3);
    if (dims.length === 0 && byKey.has("track_title")) dims.push(byKey.get("track_title")!);
    const rowEnrichedCte = buildRowEnrichedCte(dims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const dimSelect = dims.map((d) => `r.${d.field_key} AS ${d.field_key}`).join(",\n      ");
    const dimAliases = dims.map((d) => d.field_key);
    const dimWithComma = dimSelect.length > 0 ? `${dimSelect},\n      ` : "";
    const groupBy = dimAliases.length > 0 ? `GROUP BY ${dimAliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = sourceFilter ? `WHERE ${sourceFilter}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 10)));
    const sql = `${rowEnrichedCte}
    SELECT
      ${dimWithComma}SUM(COALESCE(r.gross_revenue, 0))::numeric AS gross_revenue,
      SUM(COALESCE(r.net_revenue, 0))::numeric AS net_revenue,
      AVG(COALESCE(r.mapping_confidence, 0))::numeric AS mapping_confidence,
      SUM(CASE WHEN lower(COALESCE(r.validation_status, '')) IN ('failed','critical') THEN 1 ELSE 0 END)::numeric AS validation_critical_rows,
      COUNT(*)::numeric AS row_count
    FROM row_enriched r
    ${whereSql}
    ${groupBy}
    ORDER BY gross_revenue DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: [...dimAliases, "gross_revenue", "net_revenue", "mapping_confidence", "validation_critical_rows", "row_count"],
    };
  }

  if (plan.intent === "period_comparison") {
    const periodDims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 2);
    const rowEnrichedCte = buildRowEnrichedCte(periodDims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const yearEncoded = plan.filters.find((f) => f.column === "__year_compare__" && f.op === "=" && typeof f.value === "string");
    const explicitYears = typeof yearEncoded?.value === "string"
      ? yearEncoded.value.split(",").map((value) => Number(value)).filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100).slice(0, 4)
      : [];
    const encoded = plan.filters.find((f) => f.column === "__period_compare__" && f.op === "=" && typeof f.value === "string");
    const [rawAmount, rawUnit] = typeof encoded?.value === "string" ? encoded.value.split(":") : [];
    const parsedAmount = parseAmountToken(rawAmount);
    const amount = parsedAmount ?? 90;
    const unit = unitAliasToCanonical(rawUnit) ?? "day";
    const currentOffsetSql = intervalOffsetSql(amount, unit);
    const doubleOffsetSql = intervalOffsetSql(amount * 2, unit);
    const lastLabel = `last_${amount}_${unit}${amount === 1 ? "" : "s"}`;
    const priorLabel = `prior_${amount}_${unit}${amount === 1 ? "" : "s"}`;
    const dimCols = periodDims.map((d) => d.field_key);
    const dimSelectWithComma = dimCols.length > 0 ? `${dimCols.join(",\n        ")},\n        ` : "";
    const dimGroupClause = dimCols.length > 0 ? `GROUP BY ${dimCols.join(", ")}` : "";
    const dimUsingClause = dimCols.length > 0 ? `USING (${dimCols.join(", ")})` : "ON TRUE";
    const dimFinalWithComma = dimCols.length > 0 ? `${dimCols.join(",\n      ")},\n      ` : "";
    const dimOrderBy = dimCols.length > 0 ? `${dimCols.join(", ")}, ` : "";
    const dimRowSelectWithComma = dimCols.length > 0 ? `${dimCols.join(",\n        ")},\n        ` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const sourceWhere = sourceFilter ? `AND ${sourceFilter.replaceAll("r.", "c.")}` : "";

    if (explicitYears.length >= 2) {
      const yearList = explicitYears.join(", ");
      const dimGroupWithYear = dimCols.length > 0 ? `GROUP BY 1, ${dimCols.map((_, index) => String(index + 2)).join(", ")}` : "GROUP BY 1";
      const dimFinalWithCommaForYears = dimCols.length > 0 ? `${dimCols.join(",\n      ")},\n      ` : "";
      const dimOrderForYears = dimCols.length > 0 ? `${dimCols.join(", ")}, ` : "";
      const sql = `${rowEnrichedCte}
    SELECT
      EXTRACT(YEAR FROM c.event_date)::int::text AS period_bucket,
      make_date(EXTRACT(YEAR FROM c.event_date)::int, 1, 1) AS period_start,
      make_date(EXTRACT(YEAR FROM c.event_date)::int, 12, 31) AS period_end,
      ${dimFinalWithCommaForYears}SUM(COALESCE(c.net_revenue, 0))::numeric AS net_revenue,
      SUM(COALESCE(c.gross_revenue, 0))::numeric AS gross_revenue,
      SUM(COALESCE(c.quantity, 0))::numeric AS quantity
    FROM row_enriched c
    WHERE EXTRACT(YEAR FROM c.event_date)::int IN (${yearList})
      ${sourceWhere}
    ${dimGroupWithYear}
    ORDER BY ${dimOrderForYears}period_bucket ASC`;
      return {
        sql,
        chosen_columns: [
          "period_bucket",
          "period_start",
          "period_end",
          ...periodDims.map((d) => d.field_key),
          "net_revenue",
          "gross_revenue",
          "quantity",
        ],
      };
    }

    const sql = `${rowEnrichedCte},
    bounds AS (
      SELECT MAX(c.event_date)::date AS max_date
      FROM scoped_core c
      WHERE ${sourceKindFilterSql(plan.intent, byKey)?.replaceAll("r.", "c.") ?? "TRUE"}
    ),
    last_period AS (
      SELECT
        ${dimSelectWithComma}SUM(COALESCE(c.net_revenue, 0))::numeric AS last_net_revenue,
        SUM(COALESCE(c.gross_revenue, 0))::numeric AS last_gross_revenue,
        SUM(COALESCE(c.quantity, 0))::numeric AS last_quantity
      FROM row_enriched c
      WHERE c.event_date::date > ((SELECT b.max_date FROM bounds b) - ${currentOffsetSql})::date
      ${sourceWhere}
      ${dimGroupClause}
    ),
    prior_period AS (
      SELECT
        ${dimSelectWithComma}SUM(COALESCE(c.net_revenue, 0))::numeric AS prior_net_revenue,
        SUM(COALESCE(c.gross_revenue, 0))::numeric AS prior_gross_revenue,
        SUM(COALESCE(c.quantity, 0))::numeric AS prior_quantity
      FROM row_enriched c
      WHERE c.event_date::date > ((SELECT b.max_date FROM bounds b) - ${doubleOffsetSql})::date
        AND c.event_date::date <= ((SELECT b.max_date FROM bounds b) - ${currentOffsetSql})::date
      ${sourceWhere}
      ${dimGroupClause}
    ),
    dim_rows AS (
      SELECT
        ${dimRowSelectWithComma}
        COALESCE(last_net_revenue, 0)::numeric AS last_net_revenue,
        COALESCE(last_gross_revenue, 0)::numeric AS last_gross_revenue,
        COALESCE(last_quantity, 0)::numeric AS last_quantity,
        COALESCE(prior_net_revenue, 0)::numeric AS prior_net_revenue,
        COALESCE(prior_gross_revenue, 0)::numeric AS prior_gross_revenue,
        COALESCE(prior_quantity, 0)::numeric AS prior_quantity
      FROM last_period
      FULL OUTER JOIN prior_period
        ${dimUsingClause}
    )
    SELECT
      period_bucket,
      period_start,
      period_end,
      ${dimFinalWithComma}net_revenue,
      gross_revenue,
      quantity
    FROM (
      SELECT
        1::int AS sort_order,
        '${lastLabel}'::text AS period_bucket,
        ((SELECT b.max_date FROM bounds b) - ${currentOffsetSql} + INTERVAL '1 day')::date AS period_start,
        (SELECT b.max_date FROM bounds b)::date AS period_end,
        ${dimFinalWithComma}last_net_revenue AS net_revenue,
        last_gross_revenue AS gross_revenue,
        last_quantity AS quantity
      FROM dim_rows
      UNION ALL
      SELECT
        2::int AS sort_order,
        '${priorLabel}'::text AS period_bucket,
        ((SELECT b.max_date FROM bounds b) - ${doubleOffsetSql} + INTERVAL '1 day')::date AS period_start,
        ((SELECT b.max_date FROM bounds b) - ${currentOffsetSql})::date AS period_end,
        ${dimFinalWithComma}prior_net_revenue AS net_revenue,
        prior_gross_revenue AS gross_revenue,
        prior_quantity AS quantity
      FROM dim_rows
    ) u
    ORDER BY ${dimOrderBy}sort_order`;
    return {
      sql,
      chosen_columns: [
        "period_bucket",
        "period_start",
        "period_end",
        ...periodDims.map((d) => d.field_key),
        "net_revenue",
        "gross_revenue",
        "quantity",
      ],
    };
  }

  const relativeWindowFilter = plan.filters.find((f) => f.column === "__relative_window__" && f.op === "=" && typeof f.value === "string");
  const relativeWindowValue = typeof relativeWindowFilter?.value === "string" ? relativeWindowFilter.value : null;
  const [rawWindowAmount, rawWindowUnit] = relativeWindowValue ? relativeWindowValue.split(":") : [];
  const relativeAmount = parseAmountToken(rawWindowAmount);
  const relativeUnit = unitAliasToCanonical(rawWindowUnit);
  const relativeOffsetSql = relativeAmount && relativeUnit ? intervalOffsetSql(relativeAmount, relativeUnit) : null;

  if (plan.intent === "opportunity_risk_tracks") {
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));
    const incomeFilter = sourceKindFilterSql(plan.intent, byKey)?.replaceAll("r.", "c.") ?? "TRUE";
    const sql = `WITH track_rollup AS (
      SELECT
        c.track_title,
        SUM(COALESCE(c.net_revenue, 0))::numeric AS net_revenue,
        AVG(COALESCE(c.mapping_confidence, 0))::numeric AS avg_mapping_confidence,
        SUM(CASE WHEN lower(COALESCE(c.validation_status, '')) IN ('failed','critical') THEN 1 ELSE 0 END)::numeric AS critical_rows,
        COUNT(*)::numeric AS total_rows
      FROM scoped_core c
      WHERE ${incomeFilter}
      GROUP BY 1
    ),
    scored AS (
      SELECT
        track_title,
        net_revenue,
        avg_mapping_confidence,
        critical_rows,
        total_rows,
        CASE WHEN total_rows = 0 THEN 0 ELSE (critical_rows / total_rows) END::numeric AS data_risk_ratio,
        (
          (CASE WHEN net_revenue < 0 THEN 0 ELSE net_revenue END)
          * (1 + (CASE WHEN total_rows = 0 THEN 0 ELSE (critical_rows / total_rows) END))
          * (1 + (1 - LEAST(1, GREATEST(0, avg_mapping_confidence / 100))))
        )::numeric AS opportunity_score
      FROM track_rollup
    )
    SELECT
      track_title,
      net_revenue,
      data_risk_ratio,
      avg_mapping_confidence,
      opportunity_score
    FROM scored
    ORDER BY opportunity_score DESC NULLS LAST, data_risk_ratio DESC NULLS LAST, net_revenue DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: ["track_title", "net_revenue", "mapping_confidence", "validation_status"],
    };
  }

  if (plan.intent === "rights_leakage") {
    const dims = resolveCatalogColumns(plan.dimensions, catalog, byKey)
      .filter((c) => c.field_key !== "event_date")
      .filter((c) => isSafeSqlIdentifier(c.field_key))
      .slice(0, 4);
    if (!dims.some((d) => d.field_key === "rights_type") && byKey.has("rights_type")) dims.push(byKey.get("rights_type")!);
    if (!dims.some((d) => d.field_key === "rights_stream") && byKey.has("rights_stream")) dims.push(byKey.get("rights_stream")!);
    if (!dims.some((d) => d.field_key === "track_title") && byKey.has("track_title")) dims.push(byKey.get("track_title")!);
    const rowEnrichedCte = buildRowEnrichedCte(dims.filter((d) => d.source === "custom").map((d) => d.field_key));
    const dimSelect = dims.map((d) => `r.${d.field_key} AS ${d.field_key}`).join(",\n      ");
    const dimAliases = dims.map((d) => d.field_key);
    const dimWithComma = dimSelect.length > 0 ? `${dimSelect},\n      ` : "";
    const groupBy = dimAliases.length > 0 ? `GROUP BY ${dimAliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const sourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = sourceFilter ? `WHERE ${sourceFilter}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 10)));
    const sql = `${rowEnrichedCte}
    SELECT
      ${dimWithComma}SUM(COALESCE(r.quantity, 0))::numeric AS quantity,
      SUM(COALESCE(r.gross_revenue, 0))::numeric AS gross_revenue,
      SUM(COALESCE(r.net_revenue, 0))::numeric AS net_revenue,
      CASE
        WHEN SUM(COALESCE(r.gross_revenue, 0)) = 0 THEN NULL
        ELSE (SUM(COALESCE(r.net_revenue, 0)) / NULLIF(SUM(COALESCE(r.gross_revenue, 0)), 0))::numeric
      END AS effective_royalty_rate
    FROM row_enriched r
    ${whereSql}
    ${groupBy}
    ORDER BY effective_royalty_rate ASC NULLS LAST, quantity DESC NULLS LAST
    LIMIT ${limit}`;
    return {
      sql,
      chosen_columns: [...dimAliases, "quantity", "gross_revenue", "net_revenue", "effective_royalty_rate"],
    };
  }

  // Resolve plan dimension/metric names through alias lookup — never hard-fail on a missing name
  const resolveCols = (names: string[]): CatalogColumn[] => {
    const result: CatalogColumn[] = [];
    for (const name of unique(names)) {
      const direct = byKey.get(name);
      if (direct) { result.push(direct); continue; }
      const resolved = resolveColumnByAlias(name, catalog);
      if (resolved && byKey.has(resolved)) result.push(byKey.get(resolved)!);
      // Silently skip columns that cannot be resolved — we'll use fallback metrics below
    }
    return result;
  };

  const dimensionCols = resolveCols(plan.dimensions).slice(0, 3);

  const metricCols = resolveCols(plan.metrics).slice(0, 3);

  const fallbackMetric = byKey.get("net_revenue") ?? byKey.get("gross_revenue") ?? byKey.get("quantity");
  let finalMetrics = metricCols.length > 0 ? metricCols : fallbackMetric ? [fallbackMetric] : [];
  const hasCanonicalMetric = finalMetrics.some((m) => m.source === "canonical");
  if (!hasCanonicalMetric && fallbackMetric) {
    finalMetrics = [fallbackMetric, ...finalMetrics].slice(0, 3);
  }

  // If still no metrics, pull whatever numeric column exists
  if (finalMetrics.length === 0) {
    const anyNumeric = catalog.columns.find((c) => c.inferred_type === "number");
    if (anyNumeric) finalMetrics = [anyNumeric];
  }

  if (finalMetrics.length === 0) {
    // Absolute last resort: return a COUNT query
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));
    const dimExprs = dimensionCols.map((col) => buildDimensionExpr(col, plan.grain));
    const aliases = dimExprs.map((expr) => expr.split(/\s+AS\s+/i)[1]).filter(Boolean);
    const selectList = [...dimExprs, "COUNT(*) AS row_count"].join(",\n      ");
    const baseSourceFilter = sourceKindFilterSql(plan.intent, byKey);
    const whereSql = baseSourceFilter ? `WHERE ${baseSourceFilter}` : "";
    const groupBySql = aliases.length > 0 ? `GROUP BY ${aliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const orderBySql = `ORDER BY row_count DESC NULLS LAST`;
    return {
      sql: `WITH row_enriched AS (
      SELECT c.*
      FROM scoped_core c
    )
    SELECT
      ${selectList}
    FROM row_enriched r
    ${whereSql}
    ${groupBySql}
    ${orderBySql}
    LIMIT ${limit}`,
      chosen_columns: [...dimensionCols.map((c) => c.field_key), "row_count"],
    };
  }

  const customFieldsNeeded = unique([
    ...dimensionCols.filter((d) => d.source === "custom").map((d) => d.field_key),
    ...finalMetrics.filter((m) => m.source === "custom").map((m) => m.field_key),
    ...plan.filters.map((f) => f.column).filter((field) => byKey.get(field)?.source === "custom"),
  ]);
  const canonicalFieldKeys = new Set(catalog.columns.filter((c) => c.source === "canonical").map((c) => c.field_key));
  const customFieldsProjected = customFieldsNeeded.filter((field) => !canonicalFieldKeys.has(field));

  const customProjection = customFieldsProjected
    .map(
      (field) =>
        `(SELECT sc.custom_value FROM scoped_custom sc WHERE sc.report_id = c.report_id AND sc.source_row_id = c.source_row_id AND sc.event_date = c.event_date AND lower(sc.custom_key) = lower(${quoteSqlLiteral(field)}) LIMIT 1) AS ${field}`,
    )
    .join(",\n        ");

  const selectDimensionExprs = dimensionCols.map((col) => buildDimensionExpr(col, plan.grain));
  const metricExprs = finalMetrics.map((col) => buildMetricExpr(col));
  const aliases = selectDimensionExprs.map((expr) => expr.split(/\s+AS\s+/i)[1]).filter(Boolean);
  const metricAliases = finalMetrics.map((m) => m.field_key);

  const whereClauses: string[] = [];
  const baseSourceFilter = sourceKindFilterSql(plan.intent, byKey);
  if (baseSourceFilter) whereClauses.push(baseSourceFilter);
  for (const filter of plan.filters.slice(0, 4)) {
    if (filter.column.startsWith("__")) continue;
    // Resolve filter column through alias lookup
    const resolvedField = resolveColumnByAlias(filter.column, catalog) ?? filter.column;
    const col = byKey.get(resolvedField);
    if (!col) continue;
    const colExpr = `r.${col.field_key}`;
    if (filter.op === "=" && typeof filter.value === "string") {
      whereClauses.push(`lower(${colExpr}::text) = lower(${quoteSqlLiteral(filter.value)})`);
    } else if (filter.op === "contains" && typeof filter.value === "string") {
      whereClauses.push(`lower(${colExpr}::text) LIKE lower(${quoteSqlLiteral(`%${filter.value}%`)})`);
    } else if (filter.op === "in" && Array.isArray(filter.value) && filter.value.length > 0) {
      const values = filter.value.slice(0, 20).map((v) => `lower(${quoteSqlLiteral(v)})`).join(", ");
      whereClauses.push(`lower(${colExpr}::text) IN (${values})`);
    }
  }
  if (relativeOffsetSql) {
    const sourceBoundsFilter = baseSourceFilter?.replaceAll("r.", "c.") ?? "TRUE";
    whereClauses.push(`r.event_date::date > ((SELECT MAX(c.event_date)::date FROM scoped_core c WHERE ${sourceBoundsFilter}) - ${relativeOffsetSql})::date`);
  }

  let selectList = [...selectDimensionExprs, ...metricExprs].join(",\n      ");
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const groupBySql = aliases.length > 0 ? `GROUP BY ${aliases.map((_, i) => String(i + 1)).join(", ")}` : "";
  const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));

  // Resolve sort_by through alias lookup as well
  const resolvedSortField = resolveColumnByAlias(plan.sort_by, catalog) ?? plan.sort_by;
  const requestedSort = byKey.get(resolvedSortField);
  const requestedSortKey = requestedSort?.field_key ?? null;
  const hasProjectedSortField = requestedSortKey !== null &&
    (metricAliases.includes(requestedSortKey) || aliases.includes(requestedSortKey));
  if (requestedSort && requestedSort.inferred_type === "number" && requestedSort.source === "canonical" && !hasProjectedSortField) {
    finalMetrics = [...finalMetrics, requestedSort].slice(0, 4);
    metricExprs.push(buildMetricExpr(requestedSort));
    metricAliases.push(requestedSort.field_key);
    selectList = [...selectDimensionExprs, ...metricExprs].join(",\n      ");
  }
  const orderByMetric = (requestedSortKey !== null && metricAliases.includes(requestedSortKey))
    ? requestedSortKey
    : (finalMetrics[0]?.field_key ?? aliases[0] ?? "1");
  const orderDir = plan.sort_dir === "asc" ? "ASC" : "DESC";

  // If time grain is active, always sort chronologically. Otherwise sort by metric.
  const orderBySql = plan.grain !== "none" && aliases.length > 0
    ? `ORDER BY 1 ASC`
    : `ORDER BY ${orderByMetric === "1" ? "1" : orderByMetric} ${orderDir} NULLS LAST`;

  const sql = `WITH row_enriched AS (
      SELECT
        c.*${customProjection ? `,\n        ${customProjection}` : ""}
      FROM scoped_core c
    )
    SELECT
      ${selectList}
    FROM row_enriched r
    ${whereSql}
    ${groupBySql}
    ${orderBySql}
    LIMIT ${limit}`;

  return {
    sql,
    chosen_columns: unique([
      ...dimensionCols.map((c) => c.field_key),
      ...finalMetrics.map((c) => c.field_key),
      ...plan.filters.map((f) => f.column),
    ]),
  };
}

export function validatePlannedSql(sql: string): string {
  const v = sql.trim();
  const lower = v.toLowerCase();

  if (!/^\s*(select|with)\s+/.test(lower)) throw new Error("Generated SQL must start with SELECT or WITH.");
  if (v.includes(";")) throw new Error("Generated SQL cannot include semicolons.");
  if (/--|\/\*|\*\//.test(v)) throw new Error("Generated SQL cannot include comments.");
  if (v.includes('"')) throw new Error("Generated SQL cannot include quoted identifiers.");
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|copy|call|do|truncate)\b/i.test(v)) {
    throw new Error("Generated SQL contains a disallowed keyword.");
  }
  const relationTokens = Array.from(lower.matchAll(/\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\b/g)).map((m) => m[1]);
  const blockedSchemas = new Set(["public", "auth", "storage", "extensions", "graphql_public", "pg_catalog", "information_schema"]);
  for (const rel of relationTokens) {
    const dotIndex = rel.indexOf(".");
    if (dotIndex <= 0) continue;
    const prefix = rel.slice(0, dotIndex);
    if (blockedSchemas.has(prefix)) {
      throw new Error("Generated SQL cannot reference schema-qualified relations.");
    }
  }
  return v;
}

function hasNonNullNumeric(rows: Array<Record<string, unknown>>, fields: string[]): boolean {
  for (const row of rows) {
    for (const field of fields) {
      if (!(field in row)) continue;
      const value = row[field];
      if (value === null || value === undefined || value === "") continue;
      const numeric = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(numeric)) return true;
    }
  }
  return false;
}

/**
 * Verify a query result.
 *
 * NEW behavior (results-first):
 * - If rows.length > 0: ALWAYS pass. Column-level mismatches become warnings, not failures.
 * - If rows.length === 0: fail with reason "no_rows_returned".
 *
 * This allows the AI to answer ANY question that has data, regardless of whether
 * the result table has the exact expected column names.
 */
export function verifyQueryResult({
  question,
  plan,
  columns,
  rows,
}: {
  question: string;
  plan?: AnalysisPlan;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}): VerifierStatus {
  const q = question.toLowerCase();
  const colSet = new Set(columns.map((c) => c.toLowerCase()));
  const checks: string[] = [];
  const warnings: string[] = [];
  const planMetrics = plan?.metrics.map((m) => m.toLowerCase()) ?? [];
  const planDimensions = plan?.dimensions.map((d) => d.toLowerCase()) ?? [];
  const asksRevenue = planMetrics.some((m) => m.includes("revenue") || m === "net" || m === "gross") ||
    /\b(revenue|money|earning|royalt|gross|net)\b/i.test(q);
  const asksPlatformRanking = planDimensions.includes("platform") || /\b(platform|dsp|service)\b/i.test(q);
  const asksTerritoryRanking = planDimensions.includes("territory") || /\b(territory|country|market|region)\b/i.test(q);
  const asksTrend = (plan?.grain && plan.grain !== "none") || planDimensions.includes("event_date") || plan?.intent === "period_comparison";
  const asksOwnership = plan?.intent === "rights_ownership" || /\b(owner|owns|ownership|split|share|publisher|writer|rightsholder|collect)\b/i.test(q);
  const asksEntitlement = plan?.intent === "entitlement_estimation" || /\b(owed|payable|entitlement|payout|get(?:ting)? from)\b/i.test(q);
  const hasRevenueColumn = colSet.has("net_revenue") || colSet.has("gross_revenue");
  const hasTimeColumn =
    colSet.has("event_date") ||
    colSet.has("month_start") ||
    colSet.has("quarter_start") ||
    colSet.has("week_start") ||
    colSet.has("day_start") ||
    colSet.has("period_bucket");

  if (rows.length === 0) {
    return {
      status: "failed",
      reason: "no_rows_returned",
      checks: ["row_count_check"],
      warnings: [],
    };
  }

  if (asksPlatformRanking) {
    checks.push("platform_preferred");
    if (!colSet.has("platform")) {
      warnings.push("platform column not in output; result may be aggregated across all platforms");
    }
  }

  if (asksTerritoryRanking) {
    checks.push("territory_preferred");
    if (!colSet.has("territory")) {
      warnings.push("territory column not in output; result may be aggregated across all territories");
    }
  }

  if (asksRevenue) {
    checks.push("revenue_preferred");
    if (!hasRevenueColumn) {
      warnings.push("revenue column not in output; a proxy metric may have been used");
    } else if (!hasNonNullNumeric(rows, ["net_revenue", "gross_revenue"])) {
      warnings.push("revenue values in result are zero or null");
    }
  }

  if (asksTrend) {
    checks.push("time_grain_preferred");
    if (!hasTimeColumn) {
      warnings.push("no time-grain column in output; trend may not be visible");
    }
  }

  if (asksOwnership) {
    checks.push("rights_preferred");
    if (!colSet.has("party_name")) {
      warnings.push("party dimension not in output; ownership may be aggregated");
    }
    if (!colSet.has("share_pct") || !hasNonNullNumeric(rows, ["share_pct"])) {
      warnings.push("share percentages are unavailable in the current result");
    }
  }

  if (asksEntitlement) {
    checks.push("entitlement_preferred");
    if (!colSet.has("share_pct") || !hasNonNullNumeric(rows, ["share_pct"])) {
      warnings.push("no share percentages were returned for this entitlement question");
    }
    const hasPayableSignal = rows.some((row) => {
      const shareKind = typeof row.share_kind === "string" ? row.share_kind.toLowerCase() : "";
      const basisType = typeof row.basis_type === "string" ? row.basis_type.toLowerCase() : "";
      return shareKind === "payable" || basisType === "estimated";
    });
    if (!hasPayableSignal) {
      warnings.push("payable contract terms are unavailable; answer may rely on registered rights only");
    }
  }

  const explicitTopMatch = q.match(/\b(top|highest|best|first)\s+(\d{1,3})\b/i);
  const explicitTopN = explicitTopMatch ? Number(explicitTopMatch[2]) : 0;
  if (plan && explicitTopN > 0) {
    checks.push("top_n_respected");
    if (rows.length > explicitTopN) {
      warnings.push(`expected at most ${explicitTopN} rows but got ${rows.length}`);
    }
  }

  return { status: "passed", checks, warnings };
}
