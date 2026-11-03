import { useEffect, useState } from "react"

import type { PaletteItem } from "@/components/builder/node-palette"
import {
  configurationTemplates,
  singleAgentTemplate,
} from "@/data/configuration-templates"
import {
  canDeleteConfigurationNode,
  isNodeCompatibleWithLayer,
} from "@/lib/configuration-validation"
import type {
  AgentConfiguration,
  ArchitectureType,
  ConfigurationLayer,
  ConfigurationNode,
  LayerType,
  ModelProvider,
} from "@/types/configuration"

const LAYER_DEFAULTS: Record<LayerType, string> = {
  input: "Input",
  orchestration: "Orchestration",
  agents: "Agents",
  tools: "Tools",
  aggregation: "Aggregation",
  output: "Output",
}

function clone(configuration: AgentConfiguration) {
  return structuredClone(configuration)
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(","),
    ),
  )
}

function normalizeLayerOrder(nodes: ConfigurationNode[], layerId: string) {
  const siblings = nodes
    .filter((node) => node.layerId === layerId)
    .sort((a, b) => a.order - b.order)
  const orderMap = new Map(siblings.map((node, index) => [node.id, index]))
  return nodes.map((node) => {
    if (node.layerId !== layerId) return node
    return { ...node, order: orderMap.get(node.id) ?? node.order }
  })
}

function reindexLayers(layers: ConfigurationLayer[]) {
  return layers
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((layer, index) => ({ ...layer, order: index }))
}

export function useConfigurationBuilder(
  initialConfiguration?: AgentConfiguration,
) {
  const initial = clone(initialConfiguration ?? singleAgentTemplate)

  const [configuration, setConfiguration] =
    useState<AgentConfiguration>(initial)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    initial.layers.find((l) => l.type === "agents")?.id ??
      initial.layers[0]?.id ??
      null,
  )
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)

  const selectedNode = configuration.nodes.find(
    (node) => node.id === selectedNodeId,
  )
  const canDeleteSelectedNode = canDeleteConfigurationNode(selectedNode)
  const isCustom = configuration.architecture === "custom"

  function loadTemplate(architecture: ArchitectureType) {
    const template = clone(configurationTemplates[architecture])
    setConfiguration({
      ...template,
      id: configuration.id,
      name: configuration.name,
      description: configuration.description,
      createdAt: configuration.createdAt,
      updatedAt: new Date().toISOString(),
    })
    setSelectedNodeId(null)
    setLinkSourceId(null)
    setSelectedLayerId(
      template.layers.find((l) => l.type === "agents")?.id ??
        template.layers[0]?.id ??
        null,
    )
  }

  function addComponent(item: PaletteItem, layerId?: string) {
    const targetId =
      layerId ??
      selectedLayerId ??
      configuration.layers
        .slice()
        .sort((a, b) => a.order - b.order)
        .find((entry) => isNodeCompatibleWithLayer(item.type, entry.type))?.id

    const layer = configuration.layers.find((entry) => entry.id === targetId)
    if (!layer) return
    if (!isNodeCompatibleWithLayer(item.type, layer.type)) return

    const siblingCount = configuration.nodes.filter(
      (node) => node.layerId === layer.id,
    ).length

    const newNode: ConfigurationNode = {
      id: crypto.randomUUID(),
      name: item.label,
      type: item.type,
      layerId: layer.id,
      order: siblingCount,
      metadata: {},
    }

    if (item.type === "model") {
      newNode.modelSettings = {
        provider: item.provider ?? "openai",
        model: item.model ?? "gpt-4o-mini",
        temperature: 0.5,
      }
    }

    setConfiguration({
      ...configuration,
      architecture: isCustom ? "custom" : configuration.architecture,
      nodes: [...configuration.nodes, newNode],
      updatedAt: new Date().toISOString(),
    })
    setSelectedNodeId(newNode.id)
  }

  function deleteNode(nodeId: string) {
    const logicalNode = configuration.nodes.find((node) => node.id === nodeId)
    if (!canDeleteConfigurationNode(logicalNode)) return

    const layerId = logicalNode!.layerId
    setConfiguration({
      ...configuration,
      nodes: normalizeLayerOrder(
        configuration.nodes.filter((node) => node.id !== nodeId),
        layerId,
      ),
      edges: configuration.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
      updatedAt: new Date().toISOString(),
    })
    setSelectedNodeId(null)
    if (linkSourceId === nodeId) setLinkSourceId(null)
  }

  function updateModel(
    nodeId: string,
    updates: {
      provider?: ModelProvider
      model?: string
      temperature?: number
      systemPrompt?: string
    },
  ) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId) return node
        return {
          ...node,
          modelSettings: {
            provider: node.modelSettings?.provider ?? "openai",
            model: node.modelSettings?.model ?? "gpt-4o-mini",
            ...node.modelSettings,
            ...updates,
          },
        }
      }),
    }))
  }

  function updateInstructions(nodeId: string, instructions: string) {
    updateMetadata(nodeId, { instructions })
  }

  function updateMetadata(
    nodeId: string,
    updates: NonNullable<ConfigurationNode["metadata"]>,
  ) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              metadata: { ...node.metadata, ...updates },
            }
          : node,
      ),
    }))
  }

  function clearModel(nodeId: string) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, modelSettings: undefined } : node,
      ),
    }))
  }

  function addLayer(type: LayerType) {
    if (!isCustom && configuration.architecture !== "custom") {
      // Switching into custom editing implicitly
    }
    const id = crypto.randomUUID()
    const layers = reindexLayers([
      ...configuration.layers,
      {
        id,
        name: LAYER_DEFAULTS[type],
        type,
        order: configuration.layers.length,
      },
    ])
    setConfiguration({
      ...configuration,
      architecture: "custom",
      layers,
      updatedAt: new Date().toISOString(),
    })
    setSelectedLayerId(id)
  }

  function removeLayer(layerId: string) {
    const layer = configuration.layers.find((entry) => entry.id === layerId)
    if (!layer) return
    if (layer.type === "input" || layer.type === "output") return
    if (configuration.layers.length <= 2) return

    const removedNodeIds = new Set(
      configuration.nodes
        .filter((node) => node.layerId === layerId)
        .map((node) => node.id),
    )

    setConfiguration({
      ...configuration,
      architecture: "custom",
      layers: reindexLayers(
        configuration.layers.filter((entry) => entry.id !== layerId),
      ),
      nodes: configuration.nodes.filter((node) => node.layerId !== layerId),
      edges: configuration.edges.filter(
        (edge) =>
          !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
      ),
      updatedAt: new Date().toISOString(),
    })
    if (selectedLayerId === layerId) {
      setSelectedLayerId(
        configuration.layers.find((entry) => entry.id !== layerId)?.id ?? null,
      )
    }
    if (selectedNodeId && removedNodeIds.has(selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    const ordered = configuration.layers
      .slice()
      .sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((entry) => entry.id === layerId)
    const swap = index + direction
    if (index < 0 || swap < 0 || swap >= ordered.length) return

    const next = ordered.slice()
    ;[next[index], next[swap]] = [next[swap], next[index]]

    setConfiguration({
      ...configuration,
      architecture: "custom",
      layers: reindexLayers(next),
      updatedAt: new Date().toISOString(),
    })
  }

  function renameLayer(layerId: string, name: string) {
    setConfiguration({
      ...configuration,
      architecture: "custom",
      layers: configuration.layers.map((layer) =>
        layer.id === layerId ? { ...layer, name: name.trim() || layer.name } : layer,
      ),
      updatedAt: new Date().toISOString(),
    })
  }

  function connectNodes(sourceId: string, targetId: string) {
    if (sourceId === targetId) return
    const exists = configuration.edges.some(
      (edge) => edge.source === sourceId && edge.target === targetId,
    )
    if (exists) return

    setConfiguration({
      ...configuration,
      architecture: "custom",
      edges: [
        ...configuration.edges,
        {
          id: `${sourceId}-${targetId}-${crypto.randomUUID().slice(0, 6)}`,
          source: sourceId,
          target: targetId,
        },
      ],
      updatedAt: new Date().toISOString(),
    })
  }

  function removeEdge(edgeId: string) {
    setConfiguration({
      ...configuration,
      architecture: "custom",
      edges: configuration.edges.filter((edge) => edge.id !== edgeId),
      updatedAt: new Date().toISOString(),
    })
  }

  function handleNodeSelect(nodeId: string | null) {
    if (linkSourceId && nodeId && nodeId !== linkSourceId) {
      connectNodes(linkSourceId, nodeId)
      setLinkSourceId(null)
      setSelectedNodeId(nodeId)
      return
    }
    setSelectedNodeId(nodeId)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLinkSourceId(null)
        return
      }
      if (event.key !== "Backspace" && event.key !== "Delete") return
      if (isTypingTarget(event.target)) return
      if (!selectedNodeId) return

      const logicalNode = configuration.nodes.find(
        (node) => node.id === selectedNodeId,
      )
      if (!canDeleteConfigurationNode(logicalNode)) return

      event.preventDefault()
      deleteNode(selectedNodeId)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, configuration, linkSourceId])

  function exportConfiguration(): AgentConfiguration {
    return {
      ...clone(configuration),
      updatedAt: new Date().toISOString(),
    }
  }

  return {
    configuration,
    selectedNode,
    selectedNodeId,
    selectedLayerId,
    linkSourceId,
    canDeleteSelectedNode,
    isCustom,
    setSelectedNodeId: handleNodeSelect,
    setSelectedLayerId,
    setLinkSourceId,
    loadTemplate,
    addComponent,
    deleteNode,
    updateModel,
    updateInstructions,
    updateMetadata,
    clearModel,
    addLayer,
    removeLayer,
    moveLayer,
    renameLayer,
    connectNodes,
    removeEdge,
    exportConfiguration,
  }
}

export type ConfigurationBuilderState = ReturnType<
  typeof useConfigurationBuilder
>
