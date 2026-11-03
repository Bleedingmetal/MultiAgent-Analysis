import type { ModelProvider } from "@/types/configuration"

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
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
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
  return modelsForProvider(provider)[0]?.id ?? "gpt-4o-mini"
}
