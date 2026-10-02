import {
  singleAgentTemplate,
} from "@/data/configuration-templates"

import type {
  AgentConfiguration,
} from "@/types/configuration"

const STORAGE_KEY =
  "massmutual-agent-configurations-v1"

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
      JSON.parse(
        stored,
      ) as AgentConfiguration[]

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