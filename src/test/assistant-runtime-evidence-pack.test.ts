import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runtimePath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-runtime.ts");
const workspacePath = path.resolve(process.cwd(), "supabase/functions/insights-workspace-chat/index.ts");
const representativeEvidencePath = path.resolve(process.cwd(), "supabase/functions/_shared/assistant-representative-evidence.ts");

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
    expect(runtime).toContain("buildAnswerSections");
    expect(runtime).toContain("answer_sections");
    expect(runtime).toContain("job_diagnostics");
    expect(workspace).toContain("run_workspace_evidence_plan_v1");
    expect(workspace).toContain("buildEvidencePack");
    expect(workspace).toContain("runEvidencePlan: runWorkspaceEvidencePlan");
  });

  it("keeps legacy SQL as a required baseline evidence job and treats sidecar evidence as non-blocking", () => {
    const runtime = readFileSync(runtimePath, "utf8");

    expect(runtime).toContain("buildLegacyPrimarySqlJob");
    expect(runtime).toContain("mergeSqlEvidenceJobs");
    expect(runtime).toContain("legacy-primary");
    expect(runtime).toContain("hasUsableRuntimeEvidence");
    expect(runtime).toContain("successfulSqlJobs.length === 0 && !hasUsableEvidencePack(evidencePack)");
    expect(runtime).toContain("evidencePackPrimaryTable(evidencePack)");
    expect(runtime).toContain("legacy_sql_planner_used: true");
  });

  it("does not let a total-only legacy-primary table hide richer territory evidence for touring answers", () => {
    const runtime = readFileSync(runtimePath, "utf8");
    const representativeEvidence = readFileSync(representativeEvidencePath, "utf8");

    expect(runtime).toContain("selectRepresentativeSqlJob");
    expect(representativeEvidence).toContain("scoreSqlEvidenceJobForQuestion");
    expect(representativeEvidence).toContain("questionIncludesAny(question, [\"tour\"");
    expect(representativeEvidence).toContain("columns.includes(\"territory\")");
    expect(runtime).toContain("const representativeJob = selectRepresentativeSqlJob({");
  });
});
