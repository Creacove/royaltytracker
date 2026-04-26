import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const trackChatPath = path.resolve(process.cwd(), "supabase/functions/insights-track-chat/index.ts");
const artistChatPath = path.resolve(process.cwd(), "supabase/functions/insights-artist-chat/index.ts");
const workspaceChatPath = path.resolve(process.cwd(), "supabase/functions/insights-workspace-chat/index.ts");

describe("shared assistant runtime wrappers", () => {
  it("routes track, artist, and workspace handlers through the shared assistant runtime", () => {
    const trackSource = readFileSync(trackChatPath, "utf8");
    const artistSource = readFileSync(artistChatPath, "utf8");
    const workspaceSource = readFileSync(workspaceChatPath, "utf8");

    expect(trackSource).toContain("../_shared/assistant-runtime.ts");
    expect(artistSource).toContain("../_shared/assistant-runtime.ts");
    expect(workspaceSource).toContain("../_shared/assistant-runtime.ts");
  });
});
