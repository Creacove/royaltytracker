import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { buildOpenAiProbePayload } from "../_shared/openai-probe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractOpenAiError(bodyText: string): {
  message: string | null;
  type: string | null;
  code: string | null;
  raw: unknown;
} {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)
      ? parsed.error as Record<string, unknown>
      : null;

    return {
      message: typeof error?.message === "string" ? error.message : null,
      type: typeof error?.type === "string" ? error.type : null,
      code: typeof error?.code === "string" ? error.code : null,
      raw: parsed,
    };
  } catch {
    return {
      message: null,
      type: null,
      code: null,
      raw: bodyText,
    };
  }
}

function extractSuccessPreview(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = choices[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) return null;
    const message = (first as Record<string, unknown>).message;
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    const content = (message as Record<string, unknown>).content;
    return typeof content === "string" ? content.slice(0, 500) : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const envKey = Deno.env.get("OPENAI_API_KEY") ?? null;
  const openAiKey = typeof envKey === "string" ? envKey.trim() : "";
  const configuredModel = Deno.env.get("OPENAI_MODEL") ?? null;
  const payload = buildOpenAiProbePayload(configuredModel);

  if (!openAiKey) {
    return jsonResponse({
      ok: false,
      stage: "env",
      model: payload.model,
      error_message: "Missing OPENAI_API_KEY secret.",
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();

    if (!response.ok) {
      const error = extractOpenAiError(bodyText);
      return jsonResponse({
        ok: false,
        stage: "openai",
        model: payload.model,
        http_status: response.status,
        error_message: error.message,
        error_type: error.type,
        error_code: error.code,
        raw_body: error.raw,
      });
    }

    return jsonResponse({
      ok: true,
      stage: "openai",
      model: payload.model,
      http_status: response.status,
      content_preview: extractSuccessPreview(bodyText),
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      stage: "fetch",
      model: payload.model,
      error_message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
