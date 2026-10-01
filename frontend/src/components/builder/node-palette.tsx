import type {
  DragEvent,
} from "react"

import {
  Bot,
  Combine,
  GitBranch,
  GitFork,
  Repeat2,
  Wrench,
} from "lucide-react"

import {
  ScrollArea,
} from "@/components/ui/scroll-area"

import type {
  ConfigurationNodeType,
  ModelProvider,
} from "@/types/configuration"

export const NODE_DRAG_TYPE =
  "application/agent-evaluation-node"

export interface PaletteItem {
  label: string

  type:
    ConfigurationNodeType

  provider?: ModelProvider
  model?: string
}

const items: PaletteItem[] = [
  {
    label: "GPT Agent",
    type: "model",
    provider: "openai",
    model: "GPT",
  },

  {
    label: "Claude Agent",
    type: "model",
    provider: "anthropic",
    model: "Claude",
  },

  {
    label: "Gemini Agent",
    type: "model",
    provider: "google",
    model: "Gemini",
  },

  {
    label: "Router",
    type: "router",
  },

  {
    label: "Parallel Controller",
    type: "parallel-controller",
  },

  {
    label: "Evaluator",
    type: "evaluator",
  },

  {
    label: "Aggregator",
    type: "aggregator",
  },

  {
    label: "Tool",
    type: "tool",
  },
]

function iconFor(
  type: ConfigurationNodeType,
) {
  switch (type) {
    case "model":
      return Bot

    case "router":
      return GitBranch

    case "parallel-controller":
      return GitFork

    case "evaluator":
      return Repeat2

    case "aggregator":
      return Combine

    case "tool":
      return Wrench

    default:
      return Bot
  }
}

function PaletteCard({
  item,
}: {
  item: PaletteItem
}) {
  const Icon =
    iconFor(item.type)

  function onDragStart(
    event:
      DragEvent<HTMLDivElement>,
  ) {
    event.dataTransfer.setData(
      NODE_DRAG_TYPE,
      JSON.stringify(item),
    )

    event.dataTransfer.effectAllowed =
      "move"
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="
        group flex cursor-grab
        items-center gap-3
        rounded-lg border
        border-[#303034]
        bg-[#18181a]
        px-3 py-2.5
        transition
        hover:border-[#0265ff]/70
        hover:bg-[#1e1e21]
        active:cursor-grabbing
      "
    >
      <div
        className="
          flex size-8 shrink-0
          items-center justify-center
          rounded-md bg-[#202023]
        "
      >
        <Icon
          className="
            size-4 text-zinc-400
            group-hover:text-[#4dc7eb]
          "
        />
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {item.label}
        </p>

        {item.model && (
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {item.model}
          </p>
        )}
      </div>
    </div>
  )
}

export default function NodePalette() {
  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Components
        </p>

        <p className="mt-1 text-xs text-zinc-600">
          Drag components into a compatible layer.
        </p>

        <div className="mt-5 space-y-2">
          {items.map((item) => (
            <PaletteCard
              key={item.label}
              item={item}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}