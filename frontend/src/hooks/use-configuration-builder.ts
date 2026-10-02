import {
  useEffect,
  useState,
} from "react"

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"

import {
  configurationTemplates,
  singleAgentTemplate,
} from "@/data/configuration-templates"

import {
  configurationToFlow,
  createChildFlowNode,
  getNextChildPlacement,
  getNodeHeight,
  getNodeWidth,
  getStageMinimumSize,
} from "@/lib/configuration-layout"

import {
  canDeleteConfigurationNode,
  isNodeCompatibleWithLayer,
} from "@/lib/configuration-validation"

import type {
  PaletteItem,
} from "@/components/builder/node-palette"

import type {
  AgentConfiguration,
  ArchitectureType,
  ConfigurationEdge,
  ConfigurationNode,
  ModelProvider,
} from "@/types/configuration"

function clone(
  configuration:
    AgentConfiguration,
) {
  return structuredClone(
    configuration,
  )
}

function isTypingTarget(
  target:
    EventTarget | null,
) {
  if (
    !(
      target instanceof
      HTMLElement
    )
  ) {
    return false
  }

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

function normalizeLayerOrder(
  nodes:
    ConfigurationNode[],

  layerId: string,
) {
  const siblings =
    nodes
      .filter(
        (node) =>
          node.layerId ===
          layerId,
      )
      .sort(
        (a, b) =>
          a.order -
          b.order,
      )

  const orderMap =
    new Map(
      siblings.map(
        (node, index) => [
          node.id,
          index,
        ],
      ),
    )

  return nodes.map(
    (node) => {
      if (
        node.layerId !==
        layerId
      ) {
        return node
      }

      return {
        ...node,

        order:
          orderMap.get(
            node.id,
          ) ??
          node.order,
      }
    },
  )
}

export function useConfigurationBuilder(
  initialConfiguration?:
    AgentConfiguration,
    ) {
  const initial =
    clone(
      initialConfiguration ??
        singleAgentTemplate,
    )

  const initialFlow =
    configurationToFlow(
      initial,
    )

  const [
    configuration,
    setConfiguration,
  ] =
    useState<AgentConfiguration>(
      initial,
    )

  const [
    nodes,
    setNodes,
  ] =
    useState<Node[]>(
      initialFlow.nodes,
    )

  const [
    edges,
    setEdges,
  ] =
    useState<Edge[]>(
      initialFlow.edges,
    )

  const [
    selectedNodeId,
    setSelectedNodeId,
  ] =
    useState<string | null>(
      null,
    )

  const selectedNode =
    configuration.nodes.find(
      (node) =>
        node.id ===
        selectedNodeId,
    )

  const canDeleteSelectedNode =
    canDeleteConfigurationNode(
      selectedNode,
    )

  function loadTemplate(
  architecture:
    ArchitectureType,
) {
  if (
    architecture ===
    "custom"
  ) {
    return
  }

  const template =
    clone(
      configurationTemplates[
        architecture
      ],
    )

  
  const next:
    AgentConfiguration = {
    ...template,

    id:
      configuration.id,

    name:
      configuration.name,

    description:
      configuration.description,

    createdAt:
      configuration.createdAt,

    updatedAt:
      new Date()
        .toISOString(),
  }

  const flow =
    configurationToFlow(
      next,
    )

  setConfiguration(
    next,
  )

  setNodes(
    flow.nodes,
  )

  setEdges(
    flow.edges,
  )

  setSelectedNodeId(
    null,
  )
}

  const onNodesChange = (
    changes:
      NodeChange[],
  ) => {
    setNodes(
      (current) =>
        applyNodeChanges(
          changes,
          current,
        ),
    )
  }

  const onEdgesChange = (
    changes:
      EdgeChange[],
  ) => {
    setEdges(
      (current) =>
        applyEdgeChanges(
          changes,
          current,
        ),
    )
  }

  function onConnect(
    connection:
      Connection,
  ) {
    if (
      !connection.source ||
      !connection.target
    ) {
      return
    }

    const logicalEdge:
      ConfigurationEdge = {
      id:
        `${connection.source}-${connection.target}-${crypto.randomUUID()}`,

      source:
        connection.source,

      target:
        connection.target,
    }

    setConfiguration(
      (current) => ({
        ...current,

        edges: [
          ...current.edges,
          logicalEdge,
        ],

        updatedAt:
          new Date()
            .toISOString(),
      }),
    )

    setEdges(
      (current) =>
        addEdge(
          {
            ...connection,

            id:
              logicalEdge.id,

            type:
              "smoothstep",

            markerEnd: {
              type:
                MarkerType
                  .ArrowClosed,
            },

            zIndex: 5,
          },

          current,
        ),
    )
  }

  function addPaletteItem(
    item:
      PaletteItem,

    stageId: string,
  ) {
    const stageNode =
      nodes.find(
        (node) =>
          node.id ===
            stageId &&
          node.type ===
            "stage",
      )

    if (!stageNode) {
      return
    }

    const layerId =
      String(
        stageNode.data
          .layerId ?? "",
      )

    const layer =
      configuration.layers.find(
        (layer) =>
          layer.id ===
          layerId,
      )

    if (!layer) {
      return
    }

    if (
      !isNodeCompatibleWithLayer(
        item.type,
        layer.type,
      )
    ) {
      return
    }

    const children =
      nodes.filter(
        (node) =>
          node.parentId ===
          stageId,
      )

    
    const placement =
      getNextChildPlacement(
        stageNode,
        children,
      )

    const siblingCount =
      configuration.nodes.filter(
        (node) =>
          node.layerId ===
          layerId,
      ).length

    const newNode:
      ConfigurationNode = {
      id:
        crypto.randomUUID(),

      name:
        item.label,

      type:
        item.type,

      layerId,

      order:
        siblingCount,

      metadata: {},
    }

    if (
      item.type ===
      "model"
    ) {
      newNode.modelSettings = {
        provider:
          item.provider ??
          "openai",

        model:
          item.model ??
          "GPT",

        temperature:
          0.2,
      }
    }

    const nextConfiguration:
      AgentConfiguration = {
      ...configuration,

      nodes: [
        ...configuration.nodes,
        newNode,
      ],

      updatedAt:
        new Date()
          .toISOString(),
    }

    const minimumSize =
      getStageMinimumSize(
        nextConfiguration,
        layerId,
      )

    const currentWidth =
      getNodeWidth(
        stageNode,
      )

    const currentHeight =
      getNodeHeight(
        stageNode,
      )

    const nextWidth =
      Math.max(
        currentWidth,
        placement.requiredWidth,
        minimumSize.width,
      )

    const nextHeight =
      Math.max(
        currentHeight,
        placement.requiredHeight,
        minimumSize.height,
      )

    const widthDelta =
      nextWidth -
      currentWidth

    const stageOrder =
      Number(
        stageNode.data
          .order ?? 0,
      )

    const newFlowNode =
      createChildFlowNode(
        newNode,

        stageId,

        placement.position,
      )

    setConfiguration(
      nextConfiguration,
    )

    setNodes(
      (current) => {
        const updated =
          current.map(
            (node) => {
              if (
                node.id ===
                stageId
              ) {
                return {
                  ...node,

                  data: {
                    ...node.data,

                    minWidth:
                      minimumSize.width,

                    minHeight:
                      minimumSize.height,
                  },

                  style: {
                    ...node.style,

                    width:
                      nextWidth,

                    height:
                      nextHeight,
                  },
                }
              }

              
              if (
                widthDelta >
                  0 &&
                node.type ===
                  "stage" &&
                Number(
                  node.data
                    .order ?? 0,
                ) >
                  stageOrder
              ) {
                return {
                  ...node,

                  position: {
                    ...node.position,

                    x:
                      node
                        .position
                        .x +
                      widthDelta,
                  },
                }
              }

              return node
            },
          )

        
        return [
          ...updated,
          newFlowNode,
        ]
      },
    )

    setSelectedNodeId(
      newNode.id,
    )
  }

  function deleteNode(
    nodeId: string,
  ) {
    const logicalNode =
      configuration.nodes.find(
        (node) =>
          node.id ===
          nodeId,
      )

    if (
      !canDeleteConfigurationNode(
        logicalNode,
      )
    ) {
      return
    }

    const layerId =
      logicalNode!.layerId

    let remainingNodes =
      configuration.nodes.filter(
        (node) =>
          node.id !==
          nodeId,
      )

    remainingNodes =
      normalizeLayerOrder(
        remainingNodes,
        layerId,
      )

    const nextConfiguration:
      AgentConfiguration = {
      ...configuration,

      nodes:
        remainingNodes,

      edges:
        configuration.edges.filter(
          (edge) =>
            edge.source !==
              nodeId &&
            edge.target !==
              nodeId,
        ),

      updatedAt:
        new Date()
          .toISOString(),
    }

    const newMinimum =
      getStageMinimumSize(
        nextConfiguration,
        layerId,
      )

    setConfiguration(
      nextConfiguration,
    )

    setNodes(
      (current) =>
        current
          .filter(
            (node) =>
              node.id !==
              nodeId,
          )
          .map(
            (node) => {
              if (
                String(
                  node.data
                    .layerId ??
                    "",
                ) ===
                  layerId &&
                node.type ===
                  "stage"
              ) {
                return {
                  ...node,

                  data: {
                    ...node.data,

                    minWidth:
                      newMinimum.width,

                    minHeight:
                      newMinimum.height,
                  },
                }
              }

              return node
            },
          ),
    )

    setEdges(
      (current) =>
        current.filter(
          (edge) =>
            edge.source !==
              nodeId &&
            edge.target !==
              nodeId,
        ),
    )

    setSelectedNodeId(
      null,
    )
  }

  function updateModel(
    nodeId: string,

    updates: {
      provider?:
        ModelProvider

      model?: string

      temperature?:
        number

      systemPrompt?:
        string
    },
  ) {
    setConfiguration(
      (current) => ({
        ...current,

        updatedAt:
          new Date()
            .toISOString(),

        nodes:
          current.nodes.map(
            (node) => {
              if (
                node.id !==
                nodeId
              ) {
                return node
              }

              return {
                ...node,

                modelSettings: {
                  provider:
                    node
                      .modelSettings
                      ?.provider ??
                    "openai",

                  model:
                    node
                      .modelSettings
                      ?.model ??
                    "GPT",

                  ...node
                    .modelSettings,

                  ...updates,
                },
              }
            },
          ),
      }),
    )

    setNodes(
      (current) =>
        current.map(
          (node) =>
            node.id ===
            nodeId
              ? {
                  ...node,

                  data: {
                    ...node.data,
                    ...updates,
                  },
                }
              : node,
        ),
    )
  }

  function updateInstructions(
    nodeId: string,
    instructions: string,
  ) {
    setConfiguration(
      (current) => ({
        ...current,

        updatedAt:
          new Date()
            .toISOString(),

        nodes:
          current.nodes.map(
            (node) =>
              node.id ===
              nodeId
                ? {
                    ...node,

                    metadata: {
                      ...node.metadata,

                      instructions,
                    },
                  }
                : node,
          ),
      }),
    )
  }

  
  useEffect(() => {
    function handleKeyDown(
      event:
        KeyboardEvent,
    ) {
      if (
        event.key !==
          "Backspace" &&
        event.key !==
          "Delete"
      ) {
        return
      }

      if (
        isTypingTarget(
          event.target,
        )
      ) {
        return
      }

      if (
        !selectedNodeId
      ) {
        return
      }

      const logicalNode =
        configuration.nodes.find(
          (node) =>
            node.id ===
            selectedNodeId,
        )

      if (
        !canDeleteConfigurationNode(
          logicalNode,
        )
      ) {
        return
      }

      event.preventDefault()

      deleteNode(
        selectedNodeId,
      )
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    )

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      )
    }
  }, [
    selectedNodeId,
    configuration,
  ])

  function exportConfiguration():
    AgentConfiguration {
    return {
      ...clone(
        configuration,
      ),

      edges:
        edges.map(
          (edge) => ({
            id:
              edge.id,

            source:
              edge.source,

            target:
              edge.target,

            label:
              typeof edge.label ===
              "string"
                ? edge.label
                : undefined,
          }),
        ),

      updatedAt:
        new Date()
          .toISOString(),
    }
  }

  return {
    configuration,

    nodes,
    edges,

    selectedNode,
    selectedNodeId,

    canDeleteSelectedNode,

    onNodesChange,
    onEdgesChange,
    onConnect,

    setSelectedNodeId,

    loadTemplate,

    addPaletteItem,

    deleteNode,

    updateModel,
    updateInstructions,

    exportConfiguration,
  }
}

export type ConfigurationBuilderState =
  ReturnType<
    typeof useConfigurationBuilder
  >