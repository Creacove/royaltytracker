import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("single-writer AI insights architecture", () => {
  it("does not synthesize fallback recommendations by copying why_this_matters", () => {
    const router = readRepoFile("supabase/functions/ai-insights-router-v1/index.ts");

    expect(router).not.toMatch(/rationale:\s*body\.why_this_matters/);
    expect(router).not.toMatch(/const needsDecisionGuidance[\s\S]*recommendations:\s*\[/);
  });

  it("routes AI-final-writer payloads through the preservation helper before deterministic policy", () => {
    const router = readRepoFile("supabase/functions/ai-insights-router-v1/index.ts");
    const preservationIndex = router.indexOf("return jsonResponse(buildAiFinalWriterPassThroughResponse");
    const deterministicPolicyIndex = router.indexOf("const answerPolicy = buildDecisionGradeAnswer");

    expect(preservationIndex).toBeGreaterThan(-1);
    expect(deterministicPolicyIndex).toBeGreaterThan(-1);
    expect(preservationIndex).toBeLessThan(deterministicPolicyIndex);
  });

  it("keeps UI display-only by rendering recommended_actions without creating copied recommendations", () => {
    const view = readRepoFile("src/components/insights/AiAnswerView.tsx");

    expect(view).toMatch(/recommended_actions/);
    expect(view).not.toMatch(/payload\.recommendations\?\./);
  });
});
