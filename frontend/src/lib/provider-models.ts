import type { ModelProvider } from "@/types/configuration"

// Default for new agents, templates, and anything without its own model.
export const DEFAULT_PROVIDER: ModelProvider = "anthropic"
export const DEFAULT_MODEL = "claude-opus-5-5"

export const PROVIDER_MODELS: Record<
  ModelProvider,
  { id: string; label: string }[]
> = {
  openai: [
    { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    { id: "gpt-4o", label: "gpt-4o" },
    { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { id: "gpt-4.1", label: "gpt-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  local: [
    { id: "llama3.1", label: "Llama 3.1" },
    { id: "mistral", label: "Mistral" },
  ],
  other: [
    { id: "custom", label: "Custom" },
  ],
}

export function modelsForProvider(provider: ModelProvider) {
  return PROVIDER_MODELS[provider] ?? PROVIDER_MODELS.other
}

export function defaultModelForProvider(provider: ModelProvider) {
  return modelsForProvider(provider)[0]?.id ?? DEFAULT_MODEL
}

/** Provider for a model id (matches the backend's infer_provider). */
export function providerForModel(model: string): ModelProvider {
  const m = model.toLowerCase()
  if (m.startsWith("claude")) return "anthropic"
  if (m.startsWith("gemini")) return "google"
  return "openai"
}

// Providers the backend can call (app/llm.py). Google also needs GOOGLE_API_KEY.
export const EXECUTABLE_PROVIDERS: ModelProvider[] = ["openai", "anthropic", "google"]

export function isExecutableProvider(provider?: ModelProvider | string | null) {
  return EXECUTABLE_PROVIDERS.includes(provider as ModelProvider)
}
