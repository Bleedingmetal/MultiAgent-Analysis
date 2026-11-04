import type {
  AgentConfiguration,
  ConfigurationEdge,
  ConfigurationNode,
  PromptChainOutputFormat,
  PromptChainPreviousOutputs,
  PromptStepSettings,
} from "@/types/configuration"

export const MAX_CHAIN_STEPS = 6

export const EXECUTABLE_PROVIDERS = new Set(["openai", "anthropic", "google"])

import {
  type AgentPreset,
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_TEMPLATE_VARIABLES,
  getPresets,
} from "@/lib/agent-presets"

export { DEFAULT_PROMPT_TEMPLATE, PROMPT_TEMPLATE_VARIABLES }

export type RoleOption = {
  id: string
  label: string
  description: string
  builtIn: boolean
}

const CUSTOM_OPTION: RoleOption = {
  id: "custom",
  label: "Custom",
  description: "Write your own objective and instructions.",
  builtIn: true,
}

/** Every role a specialist can take: the preset library plus "Custom". */
export function roleOptions(presets: AgentPreset[] = getPresets()): RoleOption[] {
  return [
    ...presets.map((p) => ({ id: p.id, label: p.label, description: p.description, builtIn: p.builtIn })),
    CUSTOM_OPTION,
  ]
}

function stepFromPreset(preset: AgentPreset): PromptStepSettings {
  return {
    role: preset.id,
    objective: preset.objective,
    instructions: preset.instructions,
    promptTemplate: preset.promptTemplate || DEFAULT_PROMPT_TEMPLATE,
    inputs: { task: true, previousOutputs: "last" },
    outputFormat: preset.outputFormat,
  }
}

const CUSTOM_STEP: PromptStepSettings = {
  role: "custom",
  objective: "",
  instructions: "",
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  inputs: { task: true, previousOutputs: "last" },
  outputFormat: "text",
}

export function promptStepForRole(role: string = "custom"): PromptStepSettings {
  const preset = getPresets().find((p) => p.id === role)
  return preset ? stepFromPreset(preset) : structuredClone(CUSTOM_STEP)
}

export function defaultPromptStep(
  node?: ConfigurationNode,
): PromptStepSettings {
  if (node?.promptStep) {
    return {
      ...promptStepForRole("custom"),
      ...node.promptStep,
      inputs: {
        task: node.promptStep.inputs?.task ?? true,
        previousOutputs: node.promptStep.inputs?.previousOutputs ?? "last",
      },
    }
  }
  const legacyRole = String(node?.metadata?.role ?? "")
    .trim()
    .toLowerCase()
  if (getPresets().some((p) => p.id === legacyRole)) {
    const defaults = promptStepForRole(legacyRole)
    const instructions = String(node?.metadata?.instructions ?? "").trim()
    return {
      ...defaults,
      instructions: instructions || defaults.instructions,
    }
  }
  return promptStepForRole("custom")
}

export function chainAgents(configuration: AgentConfiguration) {
  return configuration.nodes
    .filter((node) => node.type === "model")
    .slice()
    .sort((a, b) => a.order - b.order)
}

export function rebuildPromptChainEdges(
  configuration: AgentConfiguration,
): ConfigurationEdge[] {
  const input = configuration.nodes.find((node) => node.type === "input")
  const output = configuration.nodes.find((node) => node.type === "output")
  const agents = chainAgents(configuration)
  const edges: ConfigurationEdge[] = []

  function link(source: string, target: string) {
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
    })
  }

  if (input && agents[0]) link(input.id, agents[0].id)
  for (let index = 0; index < agents.length - 1; index += 1) {
    link(agents[index].id, agents[index + 1].id)
  }
  if (output && agents.length) {
    link(agents[agents.length - 1].id, output.id)
  }
  return edges
}

export function hydratePromptChain(
  configuration: AgentConfiguration,
): AgentConfiguration {
  if (configuration.architecture !== "prompt-chaining") return configuration

  const fallbackRoles: string[] = [
    "researcher",
    "analyst",
    "verifier",
  ]
  const agents = chainAgents(configuration)
  const nodes = configuration.nodes.map((node) => {
    if (node.type !== "model") return node
    if (node.promptStep) return node
    const index = agents.findIndex((agent) => agent.id === node.id)
    return {
      ...node,
      promptStep: promptStepForRole(fallbackRoles[index] ?? "custom"),
    }
  })

  const next = { ...configuration, nodes }
  return {
    ...next,
    edges: rebuildPromptChainEdges(next),
  }
}

export function roleLabel(role?: string | null) {
  const match = getPresets().find((entry) => entry.id === role)
  if (match) return match.label
  if (!role || role === "custom") return "Custom"
  return role
}

export function previousOutputsLabel(value: PromptChainPreviousOutputs) {
  switch (value) {
    case "none":
      return "None"
    case "all":
      return "All previous"
    default:
      return "Previous step"
  }
}

export function outputFormatLabel(value: PromptChainOutputFormat) {
  return value === "structured" ? "Structured JSON" : "Plain text"
}
