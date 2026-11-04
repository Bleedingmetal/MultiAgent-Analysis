"use client"

import { Bot, Combine, GitBranch, GitFork, Plus, Repeat2, Wrench } from "lucide-react"

import type {
  ConfigurationNodeType,
  ModelProvider,
} from "@/types/configuration"

export const NODE_DRAG_TYPE = "application/agent-evaluation-node"

export interface PaletteItem {
  label: string
  type: ConfigurationNodeType
  provider?: ModelProvider
  model?: string
}

const items: PaletteItem[] = [
  {
    label: "GPT Agent",
    type: "model",
    provider: "openai",
    model: "gpt-4o-mini",
  },
  {
    label: "Claude Agent",
    type: "model",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  },
  {
    label: "Gemini Agent",
    type: "model",
    provider: "google",
    model: "gemini-2.5-flash",
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

function iconFor(type: ConfigurationNodeType) {
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

interface Props {
  onAdd: (item: PaletteItem) => void
  targetLabel?: string
  allowedTypes?: ConfigurationNodeType[]
  executableProvidersOnly?: boolean
}

export default function NodePalette({
  onAdd,
  targetLabel,
  allowedTypes,
  executableProvidersOnly,
}: Props) {
  const visible = items.filter((item) => {
    if (allowedTypes && !allowedTypes.includes(item.type)) return false
    if (executableProvidersOnly && item.type === "model") {
      return item.provider === "openai"
    }
    return true
  })

  return (
    <div className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-mm-dark">Add</p>
        {targetLabel ? (
          <p className="font-data text-[11px] text-muted-foreground">
            → {targetLabel}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {visible.map((item) => {
          const Icon = iconFor(item.type)
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onAdd(item)}
              className="group flex items-center gap-2 rounded-xl border border-border/70 bg-[#fafbfd] px-3 py-2.5 text-left transition-colors hover:border-mm-charge/35 hover:bg-white"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-mm-blue/6 text-mm-blue">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-mm-dark">
                {item.label}
              </span>
              <Plus className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
