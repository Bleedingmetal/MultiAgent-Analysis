import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react"

import {
  useCallback,
  useEffect,
  useRef,
} from "react"

import NodePalette, {
  NODE_DRAG_TYPE,
  type PaletteItem,
} from "@/components/builder/node-palette"

import ModelNode from "@/components/builder/model-node"

import StageNode from "@/components/builder/stage-node"

import PropertiesPanel from "@/components/builder/properties-panel"

import {
  findStageAtPosition,
} from "@/lib/configuration-layout"

import {
  isNodeCompatibleWithLayer,
} from "@/lib/configuration-validation"

import type {
  LayerType,
} from "@/types/configuration"

import type {
  ConfigurationBuilderState,
} from "@/hooks/use-configuration-builder"

const nodeTypes = {
  model:
    ModelNode,

  stage:
    StageNode,
}

interface Props {
  builder:
    ConfigurationBuilderState
}

export default function BuilderCanvas({
  builder,
}: Props) {
  const {
    screenToFlowPosition,
    fitView,
    viewportInitialized,
  } = useReactFlow()

  const lastArchitecture =
    useRef<string>("")

  
  useEffect(() => {
    if (
      !viewportInitialized
    ) {
      return
    }

    const architecture =
      builder
        .configuration
        .architecture

    if (
      lastArchitecture.current ===
      architecture
    ) {
      return
    }

    lastArchitecture.current =
      architecture

    requestAnimationFrame(
      () => {
        void fitView({
          padding:
            0.14,

          maxZoom:
            1,

          duration:
            200,
        })
      },
    )
  }, [
    viewportInitialized,
    builder.configuration.architecture,
    fitView,
  ])

  const onDragOver =
    useCallback(
      (
        event:
          React.DragEvent<HTMLDivElement>,
      ) => {
        event.preventDefault()

        event.dataTransfer.dropEffect =
          "move"
      },
      [],
    )

  const onDrop =
    useCallback(
      (
        event:
          React.DragEvent<HTMLDivElement>,
      ) => {
        event.preventDefault()

        const raw =
          event.dataTransfer.getData(
            NODE_DRAG_TYPE,
          )

        if (!raw) {
          return
        }

        const item:
          PaletteItem =
          JSON.parse(raw)

        const position =
          screenToFlowPosition({
            x:
              event.clientX,

            y:
              event.clientY,
          })

        const stage =
          findStageAtPosition(
            builder.nodes,
            position,
          )

        if (!stage) {
          return
        }

        const layerType =
          stage.data
            .layerType as LayerType

        if (
          !isNodeCompatibleWithLayer(
            item.type,
            layerType,
          )
        ) {
          return
        }

        
        builder.addPaletteItem(
          item,
          stage.id,
        )
      },
      [
        builder,
        screenToFlowPosition,
      ],
    )

  return (
    <div
      className="
        grid
        min-h-[calc(100vh-12rem)]
        grid-cols-[230px_minmax(0,1fr)_300px]
        overflow-hidden
        rounded-xl
        border
        bg-background
      "
    >
      <aside className="border-r bg-card">
        <NodePalette />
      </aside>

      <section className="relative min-w-0 bg-muted/40">
        <ReactFlow
          nodes={
            builder.nodes
          }

          edges={
            builder.edges
          }

          nodeTypes={
            nodeTypes
          }

          onNodesChange={
            builder.onNodesChange
          }

          onEdgesChange={
            builder.onEdgesChange
          }

          onConnect={
            builder.onConnect
          }

          onDragOver={
            onDragOver
          }

          onDrop={
            onDrop
          }

          onNodeClick={(
            _,
            node,
          ) => {
            
            if (
              node.type ===
              "stage"
            ) {
              builder
                .setSelectedNodeId(
                  null,
                )

              return
            }

            builder
              .setSelectedNodeId(
                node.id,
              )
          }}

          onPaneClick={() =>
            builder
              .setSelectedNodeId(
                null,
              )
          }

          snapToGrid

          snapGrid={[
            10,
            10,
          ]}

          minZoom={
            0.3
          }

          maxZoom={
            1.4
          }

          colorMode="dark"

          
          deleteKeyCode={
            null
          }

          fitView

          fitViewOptions={{
            padding:
              0.14,

            maxZoom:
              1,
          }}

          defaultEdgeOptions={{
            type:
              "smoothstep",

            markerEnd: {
              type:
                MarkerType
                  .ArrowClosed,
            },

            style: {
              stroke:
                "#52525b",

              strokeWidth:
                1.5,
            },

            zIndex:
              5,
          }}
        >
          <Background
            gap={
              20
            }

            size={
              1
            }

            color="#242428"
          />

          <Controls />
        </ReactFlow>
      </section>

      <PropertiesPanel
        node={
          builder.selectedNode
        }

        canDelete={
          builder
            .canDeleteSelectedNode
        }

        onDelete={
          builder.deleteNode
        }

        onUpdateModel={
          builder.updateModel
        }

        onUpdateInstructions={
          builder
            .updateInstructions
        }
      />
    </div>
  )
}