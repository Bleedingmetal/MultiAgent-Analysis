import {
  Bot,
} from "lucide-react"

import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react"

import type {
  ModelProvider,
} from "@/types/configuration"

export type ModelNodeData = {
  label: string

  provider?:
    ModelProvider

  model?: string

  role?: string
} & Record<string, unknown>

export type ModelFlowNode =
  Node<
    ModelNodeData,
    "model"
  >

function providerLabel(
  provider?:
    ModelProvider,
) {
  switch (provider) {
    case "openai":
      return "OpenAI"

    case "anthropic":
      return "Anthropic"

    case "google":
      return "Google"

    case "local":
      return "Local"

    default:
      return "Model"
  }
}

export default function ModelNode({
  data,
  selected,
}: NodeProps<ModelFlowNode>) {
  return (
    <div
      className={`
        relative
        flex h-full w-full
        flex-col
        justify-center
        rounded-lg
        border
        bg-white
        px-3
        shadow-sm
        ${
          selected
            ? "border-mm-charge shadow-[0_0_0_1px_#0265ff]"
            : "border-border"
        }
      `}
    >
      <Handle
        type="target"
        position={
          Position.Left
        }
      />

      <div className="flex items-center gap-2">
        <div
          className="
            flex size-8
            shrink-0
            items-center
            justify-center
            rounded-md
            bg-mm-charge/10
          "
        >
          <Bot className="size-4 text-mm-charge" />
        </div>

        <div className="min-w-0">
          <p
            className="
              truncate
              text-xs
              font-medium
              text-mm-dark
            "
          >
            {data.label}
          </p>

          <p
            className="
              truncate
              text-[10px]
              text-muted-foreground
            "
          >
            {providerLabel(
              data.provider,
            )}

            {data.model
              ? ` · ${data.model}`
              : ""}
          </p>
        </div>
      </div>

      {data.role && (
        <p
          className="
            mt-1 truncate
            text-[9px]
            text-muted-foreground
          "
        >
          {data.role}
        </p>
      )}

      <Handle
        type="source"
        position={
          Position.Right
        }
      />
    </div>
  )
}