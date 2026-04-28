import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const functionMarker = "CREATE OR REPLACE FUNCTION public.sync_workspace_company_id()";

function readLatestSyncFunction(): string {
  const sql = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .map((fileName) => readFileSync(path.join(migrationsDir, fileName), "utf8"))
    .join("\n");

  const start = sql.lastIndexOf(functionMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const functionSql = sql.slice(start);
  const end = functionSql.indexOf("\n$$;");
  expect(end).toBeGreaterThan(0);

  return functionSql.slice(0, end + "\n$$;".length);
}

describe("sync_workspace_company_id migration", () => {
  it("does not read NEW.report_id while handling cmo_reports rows", () => {
    const functionSql = readLatestSyncFunction();
    const cmoBranchStart = functionSql.indexOf("IF TG_TABLE_NAME = 'cmo_reports' THEN");
    const nextBranchStart = functionSql.indexOf("ELSIF", cmoBranchStart);

    expect(cmoBranchStart).toBeGreaterThanOrEqual(0);
    expect(nextBranchStart).toBeGreaterThan(cmoBranchStart);
    expect(functionSql.slice(cmoBranchStart, nextBranchStart)).not.toContain("NEW.report_id");
    expect(functionSql).not.toContain("TG_TABLE_NAME <> 'cmo_reports' AND NEW.report_id");
  });
});
