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
import {
  MAX_CHAIN_STEPS,
  chainAgents,
  hydratePromptChain,
  promptStepForRole,
  rebuildPromptChainEdges,
  roleLabel,
} from "@/lib/prompt-chain"
import {
  MAX_ROUTES,
  hydrateRouting,
  promptStepForRoute,
  rebuildRoutingEdges,
  routeAgents,
} from "@/lib/routing"
import type {
  AgentConfiguration,
  ArchitectureType,
  ConfigurationLayer,
  ConfigurationNode,
  LayerType,
  ModelProvider,
  PromptChainRole,
  PromptStepSettings,
  RouterSettings,
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

function applyRoutingGraph(configuration: AgentConfiguration): AgentConfiguration {
  if (configuration.architecture !== "routing") return configuration
  const agentsLayer = configuration.layers.find((layer) => layer.type === "agents")
  const nodes = normalizeLayerOrder(
    configuration.nodes.map((node) =>
      node.type === "model" && agentsLayer
        ? { ...node, layerId: agentsLayer.id }
        : node,
    ),
    agentsLayer?.id ?? "agents",
  )
  const next = { ...configuration, nodes }
  return { ...next, edges: rebuildRoutingEdges(next) }
}

function applyChainGraph(configuration: AgentConfiguration): AgentConfiguration {
  if (configuration.architecture !== "prompt-chaining") return configuration
  const agentsLayer = configuration.layers.find((layer) => layer.type === "agents")
  const nodes = normalizeLayerOrder(
    configuration.nodes.map((node) =>
      node.type === "model" && agentsLayer
        ? { ...node, layerId: agentsLayer.id }
        : node,
    ),
    agentsLayer?.id ?? "agents",
  )
  const next = { ...configuration, nodes }
  return { ...next, edges: rebuildPromptChainEdges(next) }
}

function applyArchitectureGraph(configuration: AgentConfiguration) {
  return applyRoutingGraph(applyChainGraph(configuration))
}

function hydrateConfiguration(configuration: AgentConfiguration) {
  return hydrateRouting(hydratePromptChain(configuration))
}

export function useConfigurationBuilder(
  initialConfiguration?: AgentConfiguration,
) {
  const initial = hydrateConfiguration(
    clone(initialConfiguration ?? singleAgentTemplate),
  )

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
  const canDeleteSelectedNode =
    canDeleteConfigurationNode(selectedNode) &&
    !(
      configuration.architecture === "prompt-chaining" &&
      selectedNode?.type === "model" &&
      chainAgents(configuration).length <= 1
    ) &&
    !(
      configuration.architecture === "routing" &&
      selectedNode?.type === "model" &&
      routeAgents(configuration).length <= 1
    ) &&
    !(
      configuration.architecture === "routing" &&
      selectedNode?.type === "router"
    )
  const isCustom = configuration.architecture === "custom"

  function loadTemplate(architecture: ArchitectureType) {
    const template = hydrateConfiguration(
      clone(configurationTemplates[architecture]),
    )
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
    const chainLayerId =
      configuration.architecture === "prompt-chaining" && item.type === "model"
        ? configuration.layers.find((entry) => entry.type === "agents")?.id
        : undefined
    const routeLayerId =
      configuration.architecture === "routing" && item.type === "model"
        ? configuration.layers.find((entry) => entry.type === "agents")?.id
        : undefined
    const targetId =
      chainLayerId ??
      routeLayerId ??
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
      if (configuration.architecture === "prompt-chaining") {
        if (chainAgents(configuration).length >= MAX_CHAIN_STEPS) return
        newNode.promptStep = promptStepForRole("custom")
        newNode.name = `Agent ${siblingCount + 1}`
      }
      if (configuration.architecture === "routing") {
        if (routeAgents(configuration).length >= MAX_ROUTES) return
        newNode.promptStep = promptStepForRoute("custom")
        newNode.name = `Route ${siblingCount + 1}`
      }
    }

    const next: AgentConfiguration = {
      ...configuration,
      architecture: isCustom ? "custom" : configuration.architecture,
      nodes: [...configuration.nodes, newNode],
      updatedAt: new Date().toISOString(),
    }
    setConfiguration(applyArchitectureGraph(next))
    setSelectedNodeId(newNode.id)
  }

  function deleteNode(nodeId: string) {
    const logicalNode = configuration.nodes.find((node) => node.id === nodeId)
    if (!canDeleteConfigurationNode(logicalNode)) return

    const layerId = logicalNode!.layerId
    const next: AgentConfiguration = {
      ...configuration,
      nodes: normalizeLayerOrder(
        configuration.nodes.filter((node) => node.id !== nodeId),
        layerId,
      ),
      edges: configuration.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
      updatedAt: new Date().toISOString(),
    }
    setConfiguration(applyArchitectureGraph(next))
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

  function updateNodeName(nodeId: string, name: string) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, name: name.trim() || node.name }
          : node,
      ),
    }))
  }

  function updatePromptStep(
    nodeId: string,
    updates: Partial<PromptStepSettings>,
    options?: { applyRoleDefaults?: boolean },
  ) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId) return node
        const currentStep = node.promptStep ?? promptStepForRole("custom")
        const nextRole = (updates.role ?? currentStep.role) as PromptChainRole
        const isRouting = current.architecture === "routing"
        const roleDefaults =
          options?.applyRoleDefaults && nextRole
            ? isRouting
              ? promptStepForRoute(nextRole)
              : promptStepForRole(nextRole)
            : currentStep
        return {
          ...node,
          name: options?.applyRoleDefaults
            ? roleLabel(nextRole)
            : node.name,
          promptStep: {
            ...roleDefaults,
            ...updates,
            role: updates.role ?? roleDefaults.role,
            inputs: {
              ...roleDefaults.inputs,
              ...currentStep.inputs,
              ...updates.inputs,
            },
          },
          metadata: {
            ...node.metadata,
            role: String(updates.role ?? roleDefaults.role),
            instructions:
              updates.instructions ??
              roleDefaults.instructions ??
              node.metadata?.instructions,
          },
        }
      }),
    }))
  }

  function updateRouterSettings(
    nodeId: string,
    updates: Partial<RouterSettings>,
  ) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "router") return node
        return {
          ...node,
          routerSettings: {
            ...(node.routerSettings ?? {}),
            ...updates,
          },
        }
      }),
    }))
  }

  function moveChainAgent(nodeId: string, direction: -1 | 1) {
    setConfiguration((current) => {
      if (current.architecture !== "prompt-chaining") return current
      const agents = chainAgents(current)
      const index = agents.findIndex((node) => node.id === nodeId)
      const swap = index + direction
      if (index < 0 || swap < 0 || swap >= agents.length) return current
      const orderedIds = agents.map((node) => node.id)
      ;[orderedIds[index], orderedIds[swap]] = [
        orderedIds[swap],
        orderedIds[index],
      ]
      const orderMap = new Map(orderedIds.map((id, order) => [id, order]))
      const next: AgentConfiguration = {
        ...current,
        updatedAt: new Date().toISOString(),
        nodes: current.nodes.map((node) =>
          orderMap.has(node.id)
            ? { ...node, order: orderMap.get(node.id) ?? node.order }
            : node,
        ),
      }
      return applyChainGraph(next)
    })
  }

  function updateInstructions(nodeId: string, instructions: string) {
    setConfiguration((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              promptStep: node.promptStep
                ? { ...node.promptStep, instructions }
                : node.promptStep,
              metadata: { ...node.metadata, instructions },
            }
          : node,
      ),
    }))
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
          ? { ...node, metadata: { ...node.metadata, ...updates } }
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
    const base = clone(configuration)
    const exported =
      configuration.architecture === "prompt-chaining"
        ? applyChainGraph(hydratePromptChain(base))
        : configuration.architecture === "routing"
          ? applyRoutingGraph(hydrateRouting(base))
          : base
    return {
      ...exported,
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
    updateNodeName,
    updatePromptStep,
    updateRouterSettings,
    moveChainAgent,
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
