import {
  NodeResizeControl,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react"

import {
  useRef,
} from "react"

import type {
  StageNodeData,
} from "@/lib/configuration-layout"

export type StageFlowNode =
  Node<
    StageNodeData,
    "stage"
  >

export default function StageNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<StageFlowNode>) {
  const {
    setNodes,
  } = useReactFlow()

  const startWidth =
    useRef(
      width ??
        data.minWidth,
    )

  const startHeight =
    useRef(
      height ??
        data.minHeight,
    )

  return (
    <div
      className={`
        relative h-full w-full
        overflow-visible
        rounded-xl
        border
        bg-white
        shadow-sm
        transition-colors
        ${
          selected
            ? "border-mm-charge"
            : "border-border"
        }
      `}
    >
      <div
        className="
          flex h-11
          items-center
          justify-between
          border-b
          border-border
          px-4
        "
      >
        <span
          className="
            text-[11px]
            font-semibold
            uppercase
            tracking-[0.12em]
            text-mm-blue
          "
        >
          {data.label}
        </span>

        <span
          className="
            text-[9px]
            uppercase
            tracking-wider
            text-muted-foreground
          "
        >
          {data.orientation}
        </span>
      </div>

      <NodeResizeControl
        position="bottom-right"

        minWidth={
          data.minWidth
        }

        minHeight={
          data.minHeight
        }

        onResizeStart={() => {
          startWidth.current =
            width ??
            data.minWidth

          startHeight.current =
            height ??
            data.minHeight
        }}

        onResizeEnd={(
          _,
          params,
        ) => {
          const widthDelta =
            params.width -
            startWidth.current

          
          setNodes(
            (current) =>
              current.map(
                (node) => {
                  if (
                    node.id ===
                    id
                  ) {
                    return {
                      ...node,

                      style: {
                        ...node.style,

                        width:
                          params.width,

                        height:
                          params.height,
                      },
                    }
                  }

                  if (
                    node.type ===
                      "stage" &&
                    Number(
                      node.data
                        .order ??
                        0,
                    ) >
                      data.order
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
              ),
          )
        }}
      >
        <div
          className="
            h-4 w-4
            rounded-sm
            border-b-2
            border-r-2
            border-mm-blue/40
            bg-white
            transition-colors
            hover:border-mm-charge
          "
        />
      </NodeResizeControl>
    </div>
  )
}