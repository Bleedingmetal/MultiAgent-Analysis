import type {
  AgentConfiguration,
  ConfigurationEdge,
  ConfigurationNode,
  PromptChainOutputFormat,
  PromptChainPreviousOutputs,
  PromptChainRole,
  PromptStepSettings,
} from "@/types/configuration"

export const MAX_CHAIN_STEPS = 6

export const EXECUTABLE_PROVIDERS = new Set(["openai", "anthropic", "google"])

export const DEFAULT_PROMPT_TEMPLATE = [
  "Your role in this sequential chain of agents: {{role}}.",
  "",
  "Objective: {{objective}}",
  "",
  "{{instructions}}",
  "",
  "{{output_requirements}}",
].join("\n")

export const PROMPT_TEMPLATE_VARIABLES = [
  "role",
  "objective",
  "instructions",
  "output_requirements",
  "dataset_instructions",
] as const

export const CHAIN_ROLES: {
  id: PromptChainRole
  label: string
  description: string
  defaults: PromptStepSettings
}[] = [
  {
    id: "researcher",
    label: "Researcher",
    description: "Extract facts and evidence from the original task.",
    defaults: {
      role: "researcher",
      objective:
        "Extract the facts, figures, and evidence needed to answer the task. Do not invent values.",
      instructions:
        "Work only from the provided inputs. Quote quantities with their units. Note anything that is missing or ambiguous.",
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      inputs: { task: true, previousOutputs: "last" },
      outputFormat: "structured",
    },
  },
  {
    id: "analyst",
    label: "Analyst",
    description: "Derive an answer from the available evidence.",
    defaults: {
      role: "analyst",
      objective:
        "Use the extracted evidence to compute or derive the answer required by the task.",
      instructions:
        "Show each calculation as `expression = result`. Do not introduce facts that were not in the inputs.",
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      inputs: { task: true, previousOutputs: "last" },
      outputFormat: "structured",
    },
  },
  {
    id: "verifier",
    label: "Verifier",
    description: "Check prior work and produce the final answer.",
    defaults: {
      role: "verifier",
      objective:
        "Check the previous agent's work and produce the final answer to the original task.",
      instructions:
        "Confirm or correct the calculations. If something is unsupported, say so. Keep the final answer concise.",
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      inputs: { task: true, previousOutputs: "last" },
      outputFormat: "text",
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Write your own objective and instructions.",
    defaults: {
      role: "custom",
      objective: "",
      instructions: "",
      promptTemplate: DEFAULT_PROMPT_TEMPLATE,
      inputs: { task: true, previousOutputs: "last" },
      outputFormat: "text",
    },
  },
]

const ROLE_DEFAULTS = Object.fromEntries(
  CHAIN_ROLES.map((role) => [role.id, role.defaults]),
) as Record<PromptChainRole, PromptStepSettings>

export function promptStepForRole(
  role: PromptChainRole = "custom",
): PromptStepSettings {
  return structuredClone(ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.custom)
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
  if (legacyRole in ROLE_DEFAULTS) {
    const defaults = promptStepForRole(legacyRole as PromptChainRole)
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

  const fallbackRoles: PromptChainRole[] = [
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
  const match = CHAIN_ROLES.find((entry) => entry.id === role)
  if (match) return match.label
  if (!role) return "Custom"
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
