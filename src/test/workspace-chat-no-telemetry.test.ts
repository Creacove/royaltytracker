import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workspaceChatPath = path.resolve(
  process.cwd(),
  "supabase/functions/insights-workspace-chat/index.ts",
);

describe("workspace chat telemetry gate", () => {
  it("does not increment answer usage while telemetry is disabled", () => {
    const source = readFileSync(workspaceChatPath, "utf8");

    expect(source).not.toContain("increment_workspace_ai_usage");
  });
});
