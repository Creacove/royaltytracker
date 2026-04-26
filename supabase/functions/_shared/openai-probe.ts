export type OpenAiProbePayload = {
  model: string;
  temperature: number;
  response_format: { type: "json_object" };
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export function buildOpenAiProbePayload(model: string | null | undefined): OpenAiProbePayload {
  const resolvedModel = typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : "gpt-4o-mini";

  return {
    model: resolvedModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Return only valid JSON.",
      },
      {
        role: "user",
        content: 'Reply with {"ok":true,"source":"supabase-openai-probe"}.',
      },
    ],
  };
}
