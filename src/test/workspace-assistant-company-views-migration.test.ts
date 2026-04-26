import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260423143000_workspace_assistant_company_views_v1.sql",
);

describe("workspace assistant company views migration", () => {
  const splitTopLevelExpressions = (body: string) => {
    const expressions: string[] = [];
    let current = "";
    let depth = 0;
    let inSingleQuote = false;

    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      const next = body[index + 1] ?? "";

      if (inSingleQuote) {
        current += char;

        if (char === "'") {
          if (next === "'") {
            current += next;
            index += 1;
          } else {
            inSingleQuote = false;
          }
        }

        continue;
      }

      if (char === "'") {
        inSingleQuote = true;
        current += char;
        continue;
      }

      if (char === "(") {
        depth += 1;
        current += char;
        continue;
      }

      if (char === ")") {
        depth = Math.max(0, depth - 1);
        current += char;
        continue;
      }

      if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) expressions.push(trimmed);
        current = "";
        continue;
      }

      current += char;
    }

    const trimmed = current.trim();
    if (trimmed) expressions.push(trimmed);

    return expressions;
  };

  it("rebuilds the workspace assistant SQL surface on the new assistant views", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_workspace_assistant_catalog_v1");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.run_workspace_chat_sql_v1");
    expect(sql).toContain("public.assistant_income_scope_v1");
    expect(sql).toContain("public.assistant_rights_scope_v1");
    expect(sql).toContain("public.assistant_entitlement_scope_v1");
    expect(sql).toContain("public.assistant_quality_scope_v1");
    expect(sql).toContain("public.assistant_catalog_scope_v1");
    expect(sql).toContain("public.assistant_workspace_overview_v1");
    expect(sql).toContain("public.active_company_id()");
  });

  it("keeps every unified workspace scope union branch at the same width", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const start = sql.indexOf("CREATE OR REPLACE VIEW public.workspace_assistant_unified_scope_v1 AS");
    const end = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_workspace_assistant_catalog_v1");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const block = sql.slice(start, end);
    const sections = block.split("\nUNION ALL\n");
    expect(sections.length).toBeGreaterThanOrEqual(7);

    const widths = sections.map((section) => {
      const selectStart = section.indexOf("SELECT");
      const fromStart = section.indexOf("\nFROM");
      expect(selectStart).toBeGreaterThanOrEqual(0);
      expect(fromStart).toBeGreaterThan(selectStart);
      const body = section.slice(selectStart + "SELECT".length, fromStart);
      return splitTopLevelExpressions(body).length;
    });

    expect(new Set(widths).size).toBe(1);
  });
});
