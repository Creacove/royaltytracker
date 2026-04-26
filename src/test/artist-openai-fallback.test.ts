import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const artistChatPath = resolve(process.cwd(), "supabase/functions/insights-artist-chat/index.ts");
const fallbackHelperPath = resolve(process.cwd(), "supabase/functions/_shared/openai-fallback.ts");

describe("artist OpenAI config", () => {
  it("reads the artist OpenAI key directly from env", () => {
    const source = readFileSync(artistChatPath, "utf8");
    expect(source).toContain('const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? null;');
  });

  it("does not keep the temporary hardcoded fallback helper", () => {
    expect(existsSync(fallbackHelperPath)).toBe(false);
  });
});
