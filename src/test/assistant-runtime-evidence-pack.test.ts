import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runtimePath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-runtime.ts");
const workspacePath = path.resolve(process.cwd(), "supabase/functions/insights-workspace-chat/index.ts");

describe("assistant runtime evidence pack path", () => {
  it("keeps structured evidence plans as a sidecar instead of the primary workspace answer path", () => {
    const runtime = readFileSync(runtimePath, "utf8");
    const workspace = readFileSync(workspacePath, "utf8");

    expect(runtime).toContain("planAnswerEvidence");
    expect(runtime).toContain("multi_evidence_plan");
    expect(runtime).toContain("sql_evidence_jobs");
    expect(runtime).toContain("planEvidence");
    expect(runtime).toContain("runEvidencePlan");
    expect(runtime).not.toContain("legacy_sql_planner_used: false");
    expect(runtime).toContain("evidence_pack");
    expect(runtime).toContain("structured sidecar evidence");
    expect(workspace).toContain("run_workspace_evidence_plan_v1");
    expect(workspace).toContain("buildEvidencePack");
    expect(workspace).toContain("runEvidencePlan: runWorkspaceEvidencePlan");
  });
});
