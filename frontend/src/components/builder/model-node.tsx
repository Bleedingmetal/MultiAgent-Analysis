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
}

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
        bg-[#19191c]
        px-3
        shadow-sm
        ${
          selected
            ? "border-[#0265ff] shadow-[0_0_0_1px_#0265ff]"
            : "border-[#343438]"
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
            bg-[#202024]
          "
        >
          <Bot className="size-4 text-[#4dc7eb]" />
        </div>

        <div className="min-w-0">
          <p
            className="
              truncate
              text-xs
              font-medium
              text-zinc-100
            "
          >
            {data.label}
          </p>

          <p
            className="
              truncate
              text-[10px]
              text-zinc-500
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
            text-zinc-600
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