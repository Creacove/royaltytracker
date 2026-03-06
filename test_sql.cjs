const fs = require('fs');

// We copy the required logic to a vanilla JS file because npx tsx has output encoding issues on this windows machine.

function resolveColumnByAlias(alias, catalog) {
    const norm = alias.toLowerCase().trim();
    const byKey = catalog.columns.find(c => c.field_key.toLowerCase() === norm);
    if (byKey) return byKey.field_key;
    for (const [key, aliases] of Object.entries(catalog.aliases)) {
        if (aliases.some(a => a.toLowerCase() === norm)) return key;
    }
    return null;
}

function quoteSqlLiteral(val) {
    return "'" + String(val).replace(/'/g, "''") + "'";
}

function compileSqlFromPlan(plan, catalog) {
    const byKey = new Map();
    catalog.columns.forEach((c) => byKey.set(c.field_key, c));

    const dimensionCols = plan.dimensions
        .map((d) => catalog.columns.find(c => c.field_key === resolveColumnByAlias(d, catalog)))
        .filter(Boolean);

    let finalMetrics = plan.metrics
        .map((m) => catalog.columns.find(c => c.field_key === resolveColumnByAlias(m, catalog)))
        .filter(Boolean);

    if (finalMetrics.length === 0) {
        const revCol = catalog.columns.find((c) => c.field_key === "net_revenue");
        if (revCol) finalMetrics.push(revCol);
    }

    const selectDimensionExprs = dimensionCols.map((col) => `r.${col.field_key}::text AS ${col.field_key}`);
    const metricExprs = finalMetrics.map((col) => `sum(r.${col.field_key}::numeric) AS ${col.field_key}`);
    const aliases = selectDimensionExprs.map((expr) => expr.split(/\s+AS\s+/i)[1]).filter(Boolean);

    const groupBySql = aliases.length > 0 ? `GROUP BY ${aliases.map((_, i) => String(i + 1)).join(", ")}` : "";
    const limit = Math.min(50, Math.max(1, Number(plan.top_n || 5)));

    const resolvedSortField = resolveColumnByAlias(plan.sort_by, catalog) ?? plan.sort_by;
    const requestedSort = byKey.get(resolvedSortField);
    const orderByMetric = (requestedSort?.field_key ?? finalMetrics[0]?.field_key ?? "1");
    const orderDir = plan.sort_dir === "asc" ? "ASC" : "DESC";

    const orderBySql = plan.grain !== "none" && aliases.length > 0
        ? `ORDER BY 1 ASC`
        : `ORDER BY ${orderByMetric === "1" ? "1" : orderByMetric} ${orderDir} NULLS LAST`;

    const sql = \`WITH row_enriched AS (
      SELECT
        c.*
      FROM scoped_core c
    )
    SELECT
      \${[...selectDimensionExprs, ...metricExprs].join(",\\n      ")}
    FROM row_enriched r
    \${groupBySql}
    \${orderBySql}
    LIMIT \${limit}\`;

  return sql;
}

const catalog = {
  total_rows: 100,
  columns: [
    { field_key: "territory", inferred_type: "text", source: "canonical" },
    { field_key: "track_title", inferred_type: "text", source: "canonical" },
    { field_key: "net_revenue", inferred_type: "number", source: "canonical" }
  ],
  aliases: {}
};

const plan = {
  intent: "compare",
  metrics: ["net_revenue"],
  dimensions: ["territory", "track_title"],
  filters: [],
  grain: "none",
  time_window: "all",
  top_n: 5,
  sort_by: "net_revenue",
  sort_dir: "asc"
};

console.log("SQL Output:\n" + compileSqlFromPlan(plan, catalog));
