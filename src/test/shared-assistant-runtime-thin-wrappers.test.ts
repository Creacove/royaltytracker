import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const trackChatPath = path.resolve(process.cwd(), "supabase/functions/insights-track-chat/index.ts");
const artistChatPath = path.resolve(process.cwd(), "supabase/functions/insights-artist-chat/index.ts");
const workspaceChatPath = path.resolve(process.cwd(), "supabase/functions/insights-workspace-chat/index.ts");

describe("shared assistant runtime thin wrappers", () => {
  it("uses serveAssistantRuntime in the track, artist, and workspace handlers", () => {
    const trackSource = readFileSync(trackChatPath, "utf8");
    const artistSource = readFileSync(artistChatPath, "utf8");
    const workspaceSource = readFileSync(workspaceChatPath, "utf8");

    expect(trackSource).toContain("serveAssistantRuntime(");
    expect(artistSource).toContain("serveAssistantRuntime(");
    expect(workspaceSource).toContain("serveAssistantRuntime(");

    expect(trackSource).not.toContain("serve(async (req)");
    expect(artistSource).not.toContain("serve(async (req)");
    expect(workspaceSource).not.toContain("serve(async (req)");
  });
});
