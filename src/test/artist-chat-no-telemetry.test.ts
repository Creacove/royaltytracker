import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const artistChatPath = path.resolve(
  process.cwd(),
  "supabase/functions/insights-artist-chat/index.ts",
);

describe("artist chat telemetry gate", () => {
  it("does not increment answer usage while telemetry is disabled", () => {
    const source = readFileSync(artistChatPath, "utf8");

    expect(source).not.toContain("increment_workspace_ai_usage");
  });
});
