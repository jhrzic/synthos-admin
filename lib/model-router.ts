// ---------------------------------------------------------------------------
// Provider identity classification.
//
// A caller may name any model string. This decides, once, whether that
// string is a Gemini identifier this server can actually execute — or
// something else. A non-Gemini identifier must NEVER be silently substituted
// with a Gemini model; every real generateContent() call site gates on this
// classification first and fails explicitly instead.
//
// Pure, side-effect-free by design (no imports from server.ts) so it can be
// imported directly in tests without triggering server.ts's self-executing
// startServer() call.
// ---------------------------------------------------------------------------

export function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-3.1-flash-lite";
  const m = String(model).trim();
  if (m === "gemini-3.1-flash-lite" || m === "models/gemini-3.1-flash-lite") {
    return "gemini-3.1-flash-lite";
  }
  if (m === "gemini-3.7-flash" || m === "models/gemini-3.7-flash") {
    return "gemini-3.7-flash";
  }
  if (m === "gemini-3.1-pro-preview" || m === "models/gemini-3.1-pro-preview") {
    return "gemini-3.1-pro-preview";
  }
  // Default to confirmed live model for generic 'gemini' alias
  if (m.toLowerCase() === "gemini" || m.toLowerCase() === "google" || m.toLowerCase() === "gemini-flash") {
    return "gemini-3.1-flash-lite";
  }
  return m;
}

export type ModelRouteClassification =
  | { provider: "GEMINI"; resolvedModel: string; requestedModel: string }
  | { provider: "UNSUPPORTED"; requestedModel: string; reason: "MODEL_MAPPING_NOT_FOUND" | "UNSUPPORTED_PROVIDER"; message: string };

// Non-Gemini provider names this system recognizes by identity but has no
// configured, evidenced execution mapping for today (no credential and/or no
// verified model-id mapping wired to real generation). Recognized so the
// failure can name the provider precisely instead of a generic catch-all.
const RECOGNIZED_UNCONFIGURED_PROVIDERS = new Set([
  "claude", "anthropic",
  "deepseek",
  "hermes",
  "perplexity", "sonar",
  "chatgpt", "openai", "gpt", "gpt-4", "gpt-4o", "gpt-5", "o3",
]);

export function classifyModelRequest(model?: string): ModelRouteClassification {
  const requestedModel = (model && String(model).trim().length > 0) ? String(model).trim() : "gemini-3.1-flash-lite";
  const stripped = requestedModel.toLowerCase().startsWith("models/")
    ? requestedModel.toLowerCase().slice("models/".length)
    : requestedModel.toLowerCase();

  const resolved = normalizeGeminiModel(requestedModel);

  if (resolved.toLowerCase().startsWith("gemini")) {
    return { provider: "GEMINI", resolvedModel: resolved, requestedModel };
  }

  if (RECOGNIZED_UNCONFIGURED_PROVIDERS.has(stripped)) {
    return {
      provider: "UNSUPPORTED",
      requestedModel,
      reason: "MODEL_MAPPING_NOT_FOUND",
      message: `Model "${requestedModel}" names a recognized provider, but no configured execution mapping (credential and/or model ID) exists for it in this deployment. It was not routed to any provider.`,
    };
  }

  return {
    provider: "UNSUPPORTED",
    requestedModel,
    reason: "UNSUPPORTED_PROVIDER",
    message: `Model "${requestedModel}" is not a recognized provider identifier.`,
  };
}
