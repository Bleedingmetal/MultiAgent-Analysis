import type {
  AgentConfiguration,
  ConfigurationEdge,
  ConfigurationNode,
  PromptChainRole,
  PromptStepSettings,
  RouterSettings,
} from "@/types/configuration"
import {
  DEFAULT_PROMPT_TEMPLATE,
  EXECUTABLE_PROVIDERS,
  promptStepForRole,
  roleLabel,
} from "@/lib/prompt-chain"

export { EXECUTABLE_PROVIDERS, roleLabel }

export const MAX_ROUTES = 6

export const DEFAULT_ROUTER_TEMPLATE = [
  "You are a routing agent. Your only job is to choose which specialist should handle the incoming task.",
  "You must not answer the task yourself.",
  "",
  "{{instructions}}",
  "",
  "{{output_requirements}}",
].join("\n")

export const ROUTER_OUTPUT_REQUIREMENTS = [
  "Respond with a single JSON object and nothing else (no markdown fences).",
  'Use exactly these keys:',
  '- "selected_route": string. Must be one of the route ids listed in the user message.',
  '- "explanation": string. A concise, verifiable reason for the choice.',
].join("\n")

const ROLE_ROUTE_DESCRIPTIONS: Record<string, string> = {
  researcher:
    "Select when the task is mainly about finding facts, quotes, evidence, or extracting information from provided context.",
  analyst:
    "Select when the task requires calculations, numeric reasoning, comparisons, or deriving an answer from evidence.",
  verifier:
    "Select when the task is to check work, confirm correctness, or produce a final validated answer.",
  custom: "Select when this specialist's objective and description best match the task.",
}

function slug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "route"
  )
}

export function defaultRouteId(
  node: ConfigurationNode,
  role: string,
  index: number,
): string {
  const explicit = node.promptStep?.routeId?.trim()
  if (explicit) return slug(explicit)
  const roleSlug = slug(role)
  if (roleSlug && roleSlug !== "custom") return roleSlug
  return slug(node.id) || `route-${index + 1}`
}

export function defaultRouteDescription(
  role: string,
  objective: string,
  name: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim()
  const base =
    ROLE_ROUTE_DESCRIPTIONS[role.toLowerCase()] ?? ROLE_ROUTE_DESCRIPTIONS.custom
  const parts = [base]
  if (objective.trim()) parts.push(`Objective: ${objective.trim()}`)
  if (name.trim()) parts.push(`Specialist name: ${name.trim()}`)
  return parts.join(" ")
}

export function promptStepForRoute(role: PromptChainRole = "custom"): PromptStepSettings {
  const base = promptStepForRole(role)
  return {
    ...base,
    routeId: role === "custom" ? "" : role,
    routeDescription: defaultRouteDescription(role, base.objective, roleLabel(role)),
    // Routing specialists always answer as text for scoring.
    outputFormat: "text",
    inputs: { task: true, previousOutputs: "none" },
  }
}

export function routeAgents(configuration: AgentConfiguration) {
  return configuration.nodes
    .filter((node) => node.type === "model")
    .slice()
    .sort((a, b) => a.order - b.order)
}

export function findRouter(configuration: AgentConfiguration) {
  return configuration.nodes.find((node) => node.type === "router")
}

export function rebuildRoutingEdges(
  configuration: AgentConfiguration,
): ConfigurationEdge[] {
  const input = configuration.nodes.find((node) => node.type === "input")
  const output = configuration.nodes.find((node) => node.type === "output")
  const router = findRouter(configuration)
  const routes = routeAgents(configuration)
  const edges: ConfigurationEdge[] = []

  function link(source: string, target: string, label?: string) {
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
      label,
    })
  }

  if (input && router) link(input.id, router.id)
  for (const route of routes) {
    if (router) link(router.id, route.id, route.name)
    if (output) link(route.id, output.id)
  }
  return edges
}

export function defaultRouterSettings(): RouterSettings {
  return {
    instructions:
      "Read the task and the route catalog. Pick exactly one route id that best matches the task. Do not solve the task.",
    promptTemplate: DEFAULT_ROUTER_TEMPLATE,
    fallbackRouteId: "",
  }
}

export function hydrateRouting(
  configuration: AgentConfiguration,
): AgentConfiguration {
  if (configuration.architecture !== "routing") return configuration

  const fallbackRoles: PromptChainRole[] = ["researcher", "analyst", "verifier"]
  const routes = routeAgents(configuration)
  const nodes = configuration.nodes.map((node) => {
    if (node.type === "router") {
      const ms = node.modelSettings ?? {
        provider: "openai" as const,
        model: "gpt-4o-mini",
        temperature: 0.2,
      }
      return {
        ...node,
        modelSettings: ms,
        routerSettings: {
          ...defaultRouterSettings(),
          ...node.routerSettings,
        },
      }
    }
    if (node.type !== "model") return node
    const index = routes.findIndex((r) => r.id === node.id)
    const role = (node.promptStep?.role ??
      fallbackRoles[index] ??
      "custom") as PromptChainRole
    const defaults = promptStepForRoute(role)
    const promptStep: PromptStepSettings = {
      ...defaults,
      ...node.promptStep,
      routeId:
        node.promptStep?.routeId?.trim() ||
        defaultRouteId(node, String(role), index),
      routeDescription:
        node.promptStep?.routeDescription?.trim() ||
        defaultRouteDescription(
          String(role),
          node.promptStep?.objective ?? defaults.objective,
          node.name,
        ),
      inputs: { task: true, previousOutputs: "none" },
      outputFormat: "text",
    }
    return { ...node, promptStep }
  })

  const next = { ...configuration, nodes }
  return { ...next, edges: rebuildRoutingEdges(next) }
}

export function previewRouterPrompt(
  configuration: AgentConfiguration,
  sampleTask = "Sample task: What changed year over year?",
) {
  const router = findRouter(configuration)
  const routes = routeAgents(configuration)
  const settings = {
    ...defaultRouterSettings(),
    ...router?.routerSettings,
  }
  const system = (settings.promptTemplate ?? DEFAULT_ROUTER_TEMPLATE)
    .replace(
      "{{instructions}}",
      settings.instructions ?? defaultRouterSettings().instructions ?? "",
    )
    .replace("{{output_requirements}}", ROUTER_OUTPUT_REQUIREMENTS)

  const catalog = routes
    .map((node, index) => {
      const step = node.promptStep ?? promptStepForRoute("custom")
      const id = defaultRouteId(node, String(step.role), index)
      const desc = defaultRouteDescription(
        String(step.role),
        step.objective,
        node.name,
        step.routeDescription,
      )
      return `- id: ${id}\n  name: ${node.name}\n  role: ${roleLabel(step.role)}\n  description: ${desc}`
    })
    .join("\n")

  const user = [
    "## Original task",
    sampleTask,
    "",
    "## Available routes",
    catalog,
    "",
    "Choose the single best route id for this task.",
  ].join("\n")

  return { system, user }
}

export function previewSpecialistPrompt(node: ConfigurationNode) {
  const step = node.promptStep ?? promptStepForRoute("custom")
  const template = step.promptTemplate || DEFAULT_PROMPT_TEMPLATE
  const system = template
    .replace("{{role}}", roleLabel(step.role))
    .replace("{{objective}}", step.objective || "(objective)")
    .replace("{{instructions}}", step.instructions || "(instructions)")
    .replace(
      "{{output_requirements}}",
      "Your response is the final output of the run.",
    )
    .replace("{{dataset_instructions}}", "(added at run time on the final step)")
  return {
    system,
    user: "## Original task\n(sample task context at run time)",
  }
}
