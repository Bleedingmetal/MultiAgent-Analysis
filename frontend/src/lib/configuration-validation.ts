import type {
  ConfigurationNode,
  ConfigurationNodeType,
  LayerType,
} from "@/types/configuration"

const compatibility: Record<
  ConfigurationNodeType,
  LayerType[]
> = {
  input: ["input"],

  model: ["agents"],

  router: ["orchestration"],

  "parallel-controller": [
    "orchestration",
  ],

  evaluator: ["agents"],

  aggregator: ["aggregation"],

  tool: ["tools"],

  output: ["output"],
}

export function isNodeCompatibleWithLayer(
  nodeType: ConfigurationNodeType,
  layerType: LayerType,
) {
  return compatibility[
    nodeType
  ].includes(layerType)
}

export function canDeleteConfigurationNode(
  node?: ConfigurationNode,
) {
  if (!node) {
    return false
  }

  
  return (
    node.type !== "input" &&
    node.type !== "output"
  )
}