import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  providerForModel,
} from "@/lib/provider-models"
import {
  singleAgentTemplate,
} from "@/data/configuration-templates"

import type {
  AgentConfiguration,
} from "@/types/configuration"

const STORAGE_KEY =
  "massmutual-agent-configurations-v1"

// Run once per browser (2026-11-10): a two-pass τ²-bench batch on Sonnet was on
// course for about $10, so every saved configuration was moved to the cheapest
// Claude. Bump the key to run it again.
const CHEAPEST_MIGRATION_KEY = "massmutual-cheapest-models-v1"

function migrateToCheapestModel(
  configurations: AgentConfiguration[],
): AgentConfiguration[] {
  try {
    if (localStorage.getItem(CHEAPEST_MIGRATION_KEY)) return configurations
  } catch {
    return configurations
  }
  const migrated = configurations.map((configuration) => ({
    ...configuration,
    nodes: configuration.nodes.map((node) =>
      node.modelSettings
        ? {
            ...node,
            modelSettings: {
              ...node.modelSettings,
              provider: DEFAULT_PROVIDER,
              model: DEFAULT_MODEL,
            },
          }
        : node,
    ),
  }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    localStorage.setItem(CHEAPEST_MIGRATION_KEY, new Date().toISOString())
  } catch {
    /* storage unavailable: still return the cheaper configs for this session */
  }
  return migrated
}

export function getConfigurations():
  AgentConfiguration[] {
  if (typeof window === "undefined") {
    return []
  }

  try {
    const stored =
      localStorage.getItem(
        STORAGE_KEY,
      )

    if (!stored) {
      return []
    }

    const configurations =
      migrateToCheapestModel(
        JSON.parse(
          stored,
        ) as AgentConfiguration[],
      )

    return configurations.sort(
      (a, b) =>
        new Date(
          b.updatedAt,
        ).getTime() -
        new Date(
          a.updatedAt,
        ).getTime(),
    )
  } catch {
    return []
  }
}

export function getConfiguration(
  id: string,
):
  | AgentConfiguration
  | undefined {
  return getConfigurations().find(
    (configuration) =>
      configuration.id === id,
  )
}

export function saveConfiguration(
  configuration:
    AgentConfiguration,
) {
  if (typeof window === "undefined") {
    return configuration
  }

  const configurations =
    getConfigurations()

  const existingIndex =
    configurations.findIndex(
      (item) =>
        item.id ===
        configuration.id,
    )

  const savedConfiguration = {
    ...configuration,

    updatedAt:
      new Date().toISOString(),
  }

  if (existingIndex >= 0) {
    configurations[
      existingIndex
    ] = savedConfiguration
  } else {
    configurations.push(
      savedConfiguration,
    )
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      configurations,
    ),
  )

  return savedConfiguration
}

export function deleteConfiguration(
  id: string,
) {
  if (typeof window === "undefined") {
    return
  }

  const configurations =
    getConfigurations().filter(
      (configuration) =>
        configuration.id !==
        id,
    )

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      configurations,
    ),
  )
}

export function createNewConfiguration():
  AgentConfiguration {
  const now =
    new Date().toISOString()

  return {
    ...structuredClone(
      singleAgentTemplate,
    ),

    id:
      crypto.randomUUID(),

    name:
      "Untitled Configuration",

    description:
      undefined,

    createdAt:
      now,

    updatedAt:
      now,
  }
}

/** Clone a run's config snapshot into local configs for edit + rerun. */
export function cloneConfigurationFromSnapshot(
  snapshot: AgentConfiguration,
  options?: {
    name?: string
    modelOverride?: string
  },
): AgentConfiguration {
  const now = new Date().toISOString()
  const cloned = structuredClone(snapshot)

  if (options?.modelOverride) {
    const modelNode = cloned.nodes.find((n) => n.type === "model")
    if (modelNode) {
      modelNode.modelSettings = {
        provider: providerForModel(options.modelOverride),
        model: options.modelOverride,
        temperature: modelNode.modelSettings?.temperature ?? 0.2,
        maxTokens: modelNode.modelSettings?.maxTokens,
        systemPrompt: modelNode.modelSettings?.systemPrompt,
      }
    }
  }

  const saved = saveConfiguration({
    ...cloned,
    id: crypto.randomUUID(),
    name:
      options?.name ??
      `${cloned.name || "Config"} (from run)`,
    createdAt: now,
    updatedAt: now,
  })

  return saved
}