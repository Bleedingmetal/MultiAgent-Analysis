import {
  MarkerType,
  Position,
  type Edge,
  type Node,
  type XYPosition,
} from "@xyflow/react"

import type {
  AgentConfiguration,
  ConfigurationLayer,
  ConfigurationNode,
  LayerType,
} from "@/types/configuration"

export const NODE_WIDTH = 170
export const NODE_HEIGHT = 86

export const STAGE_GAP = 32
export const STAGE_HEADER_HEIGHT = 44
export const STAGE_PADDING = 28
export const NODE_GAP = 28

export type StageOrientation =
  | "center"
  | "horizontal"
  | "vertical"

export type StageNodeData = {
  label: string
  layerId: string
  layerType: LayerType
  order: number
  orientation: StageOrientation
  minWidth: number
  minHeight: number
} & Record<string, unknown>

export interface StageSize {
  width: number
  height: number
}

export interface StageLayout {
  id: string
  layerId: string
  name: string
  layerType: LayerType
  order: number
  orientation: StageOrientation

  x: number
  y: number
  width: number
  height: number
}

export function getStageNodeId(
  layerId: string,
) {
  return `stage:${layerId}`
}

function getLayerNodes(
  configuration: AgentConfiguration,
  layerId: string,
) {
  return configuration.nodes
    .filter(
      (node) =>
        node.layerId === layerId,
    )
    .sort(
      (a, b) =>
        a.order - b.order,
    )
}

export function getStageOrientation(
  configuration: AgentConfiguration,
  layer: ConfigurationLayer,
): StageOrientation {
  
  if (
    layer.type === "input" ||
    layer.type === "output"
  ) {
    return "center"
  }

  
  if (
    layer.type === "agents" &&
    (
      configuration.architecture ===
        "prompt-chaining" ||
      configuration.architecture ===
        "evaluator-optimizer"
    )
  ) {
    return "horizontal"
  }

  
  return "vertical"
}

function getBaseWidth(
  layerType: LayerType,
) {
  switch (layerType) {
    case "input":
    case "output":
      return 230

    case "agents":
      return 280

    case "orchestration":
    case "aggregation":
    case "tools":
      return 270
  }
}

export function getStageMinimumSize(
  configuration: AgentConfiguration,
  layerId: string,
): StageSize {
  const layer =
    configuration.layers.find(
      (layer) =>
        layer.id === layerId,
    )

  if (!layer) {
    return {
      width: 220,
      height: 240,
    }
  }

  const nodes =
    getLayerNodes(
      configuration,
      layerId,
    )

  const count =
    nodes.length

  const orientation =
    getStageOrientation(
      configuration,
      layer,
    )

  const baseWidth =
    getBaseWidth(
      layer.type,
    )

  if (
    orientation === "horizontal"
  ) {
    const contentWidth =
      count > 0
        ? count * NODE_WIDTH +
          Math.max(
            0,
            count - 1,
          ) *
            NODE_GAP +
          STAGE_PADDING * 2
        : baseWidth

    return {
      width: Math.max(
        baseWidth,
        contentWidth,
      ),

      height: 260,
    }
  }

  if (
    orientation === "vertical"
  ) {
    const contentHeight =
      count > 0
        ? STAGE_HEADER_HEIGHT +
          STAGE_PADDING * 2 +
          count * NODE_HEIGHT +
          Math.max(
            0,
            count - 1,
          ) *
            NODE_GAP
        : 260

    return {
      width: baseWidth,

      height: Math.max(
        280,
        contentHeight,
      ),
    }
  }

  return {
    width: baseWidth,
    height: 280,
  }
}

export function buildStageLayouts(
  configuration: AgentConfiguration,
): StageLayout[] {
  const layers = [
    ...configuration.layers,
  ].sort(
    (a, b) =>
      a.order - b.order,
  )

  let currentX = 0

  return layers.map(
    (layer) => {
      const size =
        getStageMinimumSize(
          configuration,
          layer.id,
        )

      const orientation =
        getStageOrientation(
          configuration,
          layer,
        )

      const stage: StageLayout = {
        id:
          getStageNodeId(
            layer.id,
          ),

        layerId:
          layer.id,

        name:
          layer.name,

        layerType:
          layer.type,

        order:
          layer.order,

        orientation,

        x:
          currentX,

        y: 0,

        width:
          size.width,

        height:
          size.height,
      }

      currentX +=
        size.width +
        STAGE_GAP

      return stage
    },
  )
}

function getInitialChildPositions(
  configuration: AgentConfiguration,
  stage: StageLayout,
) {
  const logicalNodes =
    getLayerNodes(
      configuration,
      stage.layerId,
    )

  const count =
    logicalNodes.length

  const positions =
    new Map<
      string,
      XYPosition
    >()

  if (count === 0) {
    return positions
  }

  
  if (
    stage.orientation ===
    "horizontal"
  ) {
    const totalWidth =
      count * NODE_WIDTH +
      Math.max(
        0,
        count - 1,
      ) *
        NODE_GAP

    const startX =
      (
        stage.width -
        totalWidth
      ) /
      2

    const contentHeight =
      stage.height -
      STAGE_HEADER_HEIGHT

    const y =
      STAGE_HEADER_HEIGHT +
      (
        contentHeight -
        NODE_HEIGHT
      ) /
        2

    logicalNodes.forEach(
      (node, index) => {
        positions.set(
          node.id,
          {
            x:
              startX +
              index *
                (
                  NODE_WIDTH +
                  NODE_GAP
                ),

            y,
          },
        )
      },
    )

    return positions
  }

  
  if (
    stage.orientation ===
    "vertical"
  ) {
    const totalHeight =
      count * NODE_HEIGHT +
      Math.max(
        0,
        count - 1,
      ) *
        NODE_GAP

    const contentHeight =
      stage.height -
      STAGE_HEADER_HEIGHT

    const startY =
      STAGE_HEADER_HEIGHT +
      (
        contentHeight -
        totalHeight
      ) /
        2

    const x =
      (
        stage.width -
        NODE_WIDTH
      ) /
      2

    logicalNodes.forEach(
      (node, index) => {
        positions.set(
          node.id,
          {
            x,

            y:
              startY +
              index *
                (
                  NODE_HEIGHT +
                  NODE_GAP
                ),
          },
        )
      },
    )

    return positions
  }

  
  const x =
    (
      stage.width -
      NODE_WIDTH
    ) /
    2

  const y =
    STAGE_HEADER_HEIGHT +
    (
      stage.height -
      STAGE_HEADER_HEIGHT -
      NODE_HEIGHT
    ) /
      2

  logicalNodes.forEach(
    (node, index) => {
      positions.set(
        node.id,
        {
          x,

          y:
            y +
            index *
              (
                NODE_HEIGHT +
                NODE_GAP
              ),
        },
      )
    },
  )

  return positions
}

export function createStageFlowNode(
  stage: StageLayout,
): Node {
  return {
    id:
      stage.id,

    type:
      "stage",

    position: {
      x:
        stage.x,

      y:
        stage.y,
    },

    draggable:
      false,

    deletable:
      false,

    connectable:
      false,

    selectable:
      true,

    data: {
      label:
        stage.name,

      layerId:
        stage.layerId,

      layerType:
        stage.layerType,

      order:
        stage.order,

      orientation:
        stage.orientation,

      minWidth:
        stage.width,

      minHeight:
        stage.height,
    } satisfies StageNodeData,

    style: {
      width:
        stage.width,

      height:
        stage.height,
    },

    zIndex: 0,
  }
}

export function createChildFlowNode(
  node: ConfigurationNode,
  parentId: string,
  position: XYPosition,
): Node {
  const data = {
    label:
      node.name,

    logicalNodeId:
      node.id,

    logicalType:
      node.type,

    layerId:
      node.layerId,

    logicalOrder:
      node.order,

    provider:
      node.modelSettings
        ?.provider,

    model:
      node.modelSettings
        ?.model,

    role:
      node.metadata?.role,
  }

  if (
    node.type === "model"
  ) {
    return {
      id:
        node.id,

      type:
        "model",

      parentId,

      extent:
        "parent",

      expandParent:
        false,

      position,

      data,

      style: {
        width:
          NODE_WIDTH,

        height:
          NODE_HEIGHT,
      },

      zIndex: 10,
    }
  }

  const flowType =
    node.type === "input"
      ? "input"
      : node.type ===
          "output"
        ? "output"
        : "default"

  return {
    id:
      node.id,

    type:
      flowType,

    parentId,

    extent:
      "parent",

    expandParent:
      false,

    position,

    sourcePosition:
      Position.Right,

    targetPosition:
      Position.Left,

    data,

    style: {
      width:
        NODE_WIDTH,

      height:
        NODE_HEIGHT,

      display:
        "flex",

      alignItems:
        "center",

      justifyContent:
        "center",

      background:
        "#ffffff",

      border:
        node.type ===
            "router" ||
          node.type ===
            "parallel-controller" ||
          node.type ===
            "evaluator"
          ? "1px solid #0265ff"
          : "1px solid #d5deeb",

      color:
        "#001735",

      borderRadius:
        "8px",

      padding:
        "12px",

      boxSizing:
        "border-box",

      fontSize:
        "12px",
    },

    zIndex: 10,
  }
}

export function configurationToFlow(
  configuration: AgentConfiguration,
) {
  const stages =
    buildStageLayouts(
      configuration,
    )

  
  const stageNodes =
    stages.map(
      createStageFlowNode,
    )

  const childNodes =
    configuration.nodes.map(
      (logicalNode) => {
        const stage =
          stages.find(
            (stage) =>
              stage.layerId ===
              logicalNode.layerId,
          )

        if (!stage) {
          throw new Error(
            `Missing stage for ${logicalNode.layerId}`,
          )
        }

        const positions =
          getInitialChildPositions(
            configuration,
            stage,
          )

        return createChildFlowNode(
          logicalNode,

          stage.id,

          positions.get(
            logicalNode.id,
          ) ?? {
            x:
              STAGE_PADDING,

            y:
              STAGE_HEADER_HEIGHT +
              STAGE_PADDING,
          },
        )
      },
    )

  const edges: Edge[] =
    configuration.edges.map(
      (edge) => ({
        id:
          edge.id,

        source:
          edge.source,

        target:
          edge.target,

        label:
          edge.label,

        type:
          "smoothstep",

        markerEnd: {
          type:
            MarkerType.ArrowClosed,
        },

        style: {
          stroke:
            "#52525b",

          strokeWidth:
            1.5,
        },

        zIndex: 5,
      }),
    )

  return {
    nodes: [
      ...stageNodes,
      ...childNodes,
    ],

    edges,
  }
}

export function getNodeWidth(
  node: Node,
) {
  if (
    node.measured?.width
  ) {
    return node.measured.width
  }

  if (node.width) {
    return node.width
  }

  const value =
    node.style?.width

  if (
    typeof value ===
    "number"
  ) {
    return value
  }

  return NODE_WIDTH
}

export function getNodeHeight(
  node: Node,
) {
  if (
    node.measured?.height
  ) {
    return node.measured.height
  }

  if (node.height) {
    return node.height
  }

  const value =
    node.style?.height

  if (
    typeof value ===
    "number"
  ) {
    return value
  }

  return NODE_HEIGHT
}

export function findStageAtPosition(
  nodes: Node[],
  position: XYPosition,
) {
  return nodes.find(
    (node) => {
      if (
        node.type !==
        "stage"
      ) {
        return false
      }

      const width =
        getNodeWidth(node)

      const height =
        getNodeHeight(node)

      return (
        position.x >=
          node.position.x &&
        position.x <=
          node.position.x +
            width &&
        position.y >=
          node.position.y &&
        position.y <=
          node.position.y +
            height
      )
    },
  )
}

export function getNextChildPlacement(
  stage: Node,
  children: Node[],
) {
  const width =
    getNodeWidth(stage)

  const height =
    getNodeHeight(stage)

  const orientation =
    String(
      stage.data
        .orientation ??
        "vertical",
    ) as StageOrientation

  
  if (
    children.length === 0
  ) {
    return {
      position: {
        x:
          (
            width -
            NODE_WIDTH
          ) /
          2,

        y:
          STAGE_HEADER_HEIGHT +
          (
            height -
            STAGE_HEADER_HEIGHT -
            NODE_HEIGHT
          ) /
            2,
      },

      requiredWidth:
        width,

      requiredHeight:
        height,
    }
  }

  
  if (
    orientation ===
    "horizontal"
  ) {
    const furthestRight =
      Math.max(
        ...children.map(
          (child) =>
            child.position.x +
            getNodeWidth(
              child,
            ),
        ),
      )

    const y =
      children[0]
        .position.y

    const x =
      furthestRight +
      NODE_GAP

    return {
      position: {
        x,
        y,
      },

      requiredWidth:
        Math.max(
          width,

          x +
            NODE_WIDTH +
            STAGE_PADDING,
        ),

      requiredHeight:
        height,
    }
  }

  
  const furthestBottom =
    Math.max(
      ...children.map(
        (child) =>
          child.position.y +
          getNodeHeight(
            child,
          ),
      ),
    )

  const x =
    children[0]
      .position.x

  const y =
    furthestBottom +
    NODE_GAP

  return {
    position: {
      x,
      y,
    },

    requiredWidth:
      width,

    requiredHeight:
      Math.max(
        height,

        y +
          NODE_HEIGHT +
          STAGE_PADDING,
      ),
  }
}