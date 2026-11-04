export type ArchitectureType =
  | "single-agent"
  | "prompt-chaining"
  | "routing"
  | "parallelization"
  | "evaluator-optimizer"
  | "autonomous-agent"
  | "custom"

export type LayerType =
  | "input"
  | "orchestration"
  | "agents"
  | "tools"
  | "aggregation"
  | "output"

export type ConfigurationNodeType =
  | "input"
  | "model"
  | "router"
  | "parallel-controller"
  | "evaluator"
  | "aggregator"
  | "tool"
  | "output"

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "local"
  | "other"

export interface ConfigurationLayer {
  id: string
  name: string
  type: LayerType
  order: number
}

export interface ModelSettings {
  provider: ModelProvider
  model: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

// Built-in roles plus any custom preset id from the Agent prompts page
export type PromptChainRole =
  | "researcher"
  | "analyst"
  | "verifier"
  | "calculator"
  | "custom"
  | (string & {})
export type PromptChainPreviousOutputs = "none" | "last" | "all"
export type PromptChainOutputFormat = "text" | "structured"

export interface PromptStepInputs {
  task: boolean
  previousOutputs: PromptChainPreviousOutputs
}

export interface PromptStepSettings {
  role: PromptChainRole | string
  objective: string
  instructions: string
  promptTemplate: string
  inputs: PromptStepInputs
  outputFormat: PromptChainOutputFormat
  /** Stable id the router must return in `selected_route`. */
  routeId?: string
  /** When the router should pick this specialist. */
  routeDescription?: string
}

export interface RouterSettings {
  instructions?: string
  promptTemplate?: string
  fallbackRouteId?: string
}

export interface ConfigurationNode {
  id: string
  name: string
  type: ConfigurationNodeType

  layerId: string

  
  order: number

  modelSettings?: ModelSettings
  promptStep?: PromptStepSettings
  routerSettings?: RouterSettings

  metadata?: {
    role?: string
    instructions?: string
    [key: string]: unknown
  }
}

export interface ConfigurationEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface AgentConfiguration {
  version: 1

  id: string
  name: string
  description?: string

  architecture: ArchitectureType

  createdAt: string
  updatedAt: string

  layers: ConfigurationLayer[]
  nodes: ConfigurationNode[]
  edges: ConfigurationEdge[]
}