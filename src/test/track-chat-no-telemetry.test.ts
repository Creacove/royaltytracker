import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const trackChatPath = path.resolve(
  process.cwd(),
  "supabase/functions/insights-track-chat/index.ts",
);

describe("track chat telemetry gate", () => {
  it("does not increment answer usage while telemetry is disabled", () => {
    const source = readFileSync(trackChatPath, "utf8");

    expect(source).not.toContain("increment_workspace_ai_usage");
  });
});
