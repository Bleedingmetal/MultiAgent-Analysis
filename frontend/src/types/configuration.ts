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

export interface ConfigurationNode {
  id: string
  name: string
  type: ConfigurationNodeType

  layerId: string

  /**
   * Logical order inside the layer.
   * This is saved. Visual x/y position is not.
   */
  order: number

  modelSettings?: ModelSettings

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