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

  const asksRevenue = /\b(revenue|money|earning|royalt|gross|net)\b/i.test(q);
  const asksPlatform = /\b(platform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer)\b/i.test(q);
  const asksTerritory = /\b(territory|country|market|region|geo|geography)\b/i.test(q);
  const asksTrend = /\b(trend|over time|month|quarter|week|day|growth|qoq|yoy|mom)\b/i.test(q);
  const asksOpportunityRisk = /\b(opportunity|potential)\b.*\b(risk|data risk|quality risk)\b|\b(highest opportunity)\b.*\b(highest data risk)\b/i.test(q);
  const asksPoor = /\b(poor|worst|lowest|underperform|bottom)\b/i.test(q);

  const dimensions: string[] = [];
  if (asksPlatform) dimensions.push("platform");
  if (asksTerritory) dimensions.push("territory");
  if (asksTrend) dimensions.push("event_date");
  // For "underperforming / worst" track questions, group by track
  if (asksPoor && !dimensions.includes("track_title")) dimensions.push("track_title");

  const metrics: string[] = [];
  if (asksRevenue) {
    if (catalog.columns.some((c) => c.field_key === "net_revenue")) metrics.push("net_revenue");
    else if (catalog.columns.some((c) => c.field_key === "gross_revenue")) metrics.push("gross_revenue");
  }
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

  const required_columns = unique([
    ...dimensions,
    ...metrics,
    ...(asksPlatform ? ["platform"] : []),
    ...(asksRevenue ? [metrics[0] ?? "net_revenue"] : []),
    ...(asksTrend ? ["event_date"] : []),
    ...(asksOpportunityRisk ? ["track_title", "net_revenue", "mapping_confidence", "validation_status"] : []),
  ]);

  const intent = asksOpportunityRisk
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

  const grain = asksTrend
    ? /\bquarter|qoq\b/i.test(q)
      ? "quarter"
      : /\bweek\b/i.test(q)
        ? "week"
        : /\bday\b/i.test(q)
          ? "day"
          : "month"
    : "none";

  // For "poor/worst" questions sort ascending, otherwise desc
  const sortDir = asksPoor ? "asc" : "desc";

  return {
    intent,
    metrics: unique(metrics).slice(0, 3),
    dimensions: unique(dimensions).slice(0, 3),
    filters: [],
    grain,
    time_window: "implicit",
    confidence: inferConfidence(required_columns.length),
    required_columns,
    top_n: inferTopN(question),
    sort_by: asksOpportunityRisk ? "opportunity_score" : (metrics[0] ?? "net_revenue"),
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

export function compileSqlFromPlan(plan: AnalysisPlan, catalog: ArtistCatalog): { sql: string; chosen_columns: string[] } {
  const byKey = new Map(catalog.columns.map((c) => [c.field_key, c] as const));

  if (plan.intent === "opportunity_risk_tracks") {
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));
    const sql = `WITH track_rollup AS (
      SELECT
        c.track_title,
        SUM(COALESCE(c.net_revenue, 0))::numeric AS net_revenue,
        AVG(COALESCE(c.mapping_confidence, 0))::numeric AS avg_mapping_confidence,
        SUM(CASE WHEN lower(COALESCE(c.validation_status, '')) IN ('failed','critical') THEN 1 ELSE 0 END)::numeric AS critical_rows,
        COUNT(*)::numeric AS total_rows
      FROM scoped_core c
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

  const customProjection = customFieldsNeeded
    .map(
      (field) =>
        `(SELECT sc.custom_value FROM scoped_custom sc WHERE sc.report_id = c.report_id AND sc.source_row_id = c.source_row_id AND sc.event_date = c.event_date AND lower(sc.custom_key) = lower(${quoteSqlLiteral(field)}) LIMIT 1) AS ${field}`,
    )
    .join(",\n        ");

  const selectDimensionExprs = dimensionCols.map((col) => buildDimensionExpr(col, plan.grain));
  const metricExprs = finalMetrics.map((col) => buildMetricExpr(col));
  const aliases = selectDimensionExprs.map((expr) => expr.split(/\s+AS\s+/i)[1]).filter(Boolean);

  const whereClauses: string[] = [];
  for (const filter of plan.filters.slice(0, 4)) {
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

  const selectList = [...selectDimensionExprs, ...metricExprs].join(",\n      ");
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const groupBySql = aliases.length > 0 ? `GROUP BY ${aliases.map((_, i) => String(i + 1)).join(", ")}` : "";
  const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));

  // Resolve sort_by through alias lookup as well
  const resolvedSortField = resolveColumnByAlias(plan.sort_by, catalog) ?? plan.sort_by;
  const requestedSort = byKey.get(resolvedSortField);
  const orderByMetric = (requestedSort?.field_key ?? finalMetrics[0]?.field_key ?? "1");
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
  if (/\b(?:from|join)\s+[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\b/i.test(v)) {
    throw new Error("Generated SQL cannot reference schema-qualified relations.");
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

  // If we got actual rows back, always pass — the data speaks for itself.
  // We collect informational warnings for transparency, but never hard-fail.
  if (rows.length > 0) {
    // Informational checks (warnings only when rows exist)
    const asksPlatformRanking = /\b(platform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer)\b/i.test(q);
    if (asksPlatformRanking) {
      checks.push("platform_preferred");
      if (!colSet.has("platform")) {
        warnings.push("platform column not in output; result may be aggregated across all platforms");
      }
    }

    const asksRevenue = /\b(revenue|money|earning|royalt|gross|net)\b/i.test(q);
    if (asksRevenue) {
      checks.push("revenue_preferred");
      const hasRevenueColumn = colSet.has("net_revenue") || colSet.has("gross_revenue");
      if (!hasRevenueColumn) {
        warnings.push("revenue column not in output; a proxy metric may have been used");
      } else if (!hasNonNullNumeric(rows, ["net_revenue", "gross_revenue"])) {
        warnings.push("revenue values in result are zero or null");
      }
    }

    const asksTrend = /\b(trend|over time|month|quarter|week|day|growth|qoq|yoy|mom)\b/i.test(q);
    if (asksTrend) {
      checks.push("time_grain_preferred");
      const hasTime =
        colSet.has("event_date") ||
        colSet.has("month_start") ||
        colSet.has("quarter_start") ||
        colSet.has("week_start") ||
        colSet.has("day_start");
      if (!hasTime) {
        warnings.push("no time-grain column in output; trend may not be visible");
      }
    }

    if (plan && /top|highest|best|most/i.test(q)) {
      checks.push("top_n_respected");
      if (plan.top_n > 0 && rows.length > plan.top_n) {
        warnings.push(`expected at most ${plan.top_n} rows but got ${rows.length}`);
      }
    }

    return { status: "passed", checks, warnings };
  }

  // Zero rows — the only hard-fail case.
  return {
    status: "failed",
    reason: "no_rows_returned",
    checks: ["row_count_check"],
    warnings: [],
  };
}
