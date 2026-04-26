import { describe, expect, it } from "vitest";

import { buildOpenAiProbePayload } from "../../supabase/functions/_shared/openai-probe.ts";

describe("buildOpenAiProbePayload", () => {
  it("uses the provided model", () => {
    const payload = buildOpenAiProbePayload("gpt-4o");
    expect(payload.model).toBe("gpt-4o");
  });

  it("falls back to gpt-4o-mini when the model is missing", () => {
    const payload = buildOpenAiProbePayload(null);
    expect(payload.model).toBe("gpt-4o-mini");
  });
});
