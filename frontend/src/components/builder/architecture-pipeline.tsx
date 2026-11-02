"use client"

import {
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Combine,
  GitBranch,
  GitFork,
  Inbox,
  Plus,
  Repeat2,
  Send,
  Wrench,
} from "lucide-react"

import { defaultPromptStep, roleLabel } from "@/lib/prompt-chain"
import { cn } from "@/lib/utils"
import type {
  ArchitectureType,
  ConfigurationLayer,
  ConfigurationNode,
  ConfigurationNodeType,
} from "@/types/configuration"

function iconFor(type: ConfigurationNodeType) {
  switch (type) {
    case "input":
      return Inbox
    case "output":
      return Send
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

function nodeMeta(node: ConfigurationNode, isPromptChain: boolean) {
  if (node.type === "model" && node.modelSettings) {
    const role = isPromptChain
      ? roleLabel(defaultPromptStep(node).role)
      : null
    return [role, node.modelSettings.model].filter(Boolean).join(" · ")
  }
  return null
}

interface Props {
  layers: ConfigurationLayer[]
  nodes: ConfigurationNode[]
  selectedNodeId: string | null
  architecture?: ArchitectureType
  onSelect: (nodeId: string | null) => void
  onMoveNode?: (nodeId: string, direction: -1 | 1) => void
  onAddAgent?: () => void
  canAddAgent?: boolean
}

export default function ArchitecturePipeline({
  layers,
  nodes,
  selectedNodeId,
  architecture,
  onSelect,
  onMoveNode,
  onAddAgent,
  canAddAgent,
}: Props) {
  const isPromptChain = architecture === "prompt-chaining"
  const orderedLayers = layers.slice().sort((a, b) => a.order - b.order)

  return (
    <div className="rounded-2xl border border-border/80 bg-white">
      <div className="border-b border-border/70 px-5 py-3.5">
        <p className="text-[13px] font-semibold text-mm-dark">Pipeline</p>
        {isPromptChain ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Agents run top to bottom. Click one to edit it.
          </p>
        ) : null}
      </div>

      <div className="flex items-stretch justify-center gap-2 p-5 sm:gap-3">
        {orderedLayers.map((layer, index) => {
          const layerNodes = nodes
            .filter((node) => node.layerId === layer.id)
            .sort((a, b) => a.order - b.order)

          return (
            <div
              key={layer.id}
              className="flex min-w-0 flex-1 items-stretch gap-2 sm:gap-3"
            >
              <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border/80 bg-[#f7f9fc]">
                <header className="border-b border-border/60 px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mm-blue">
                    {layer.name}
                  </p>
                </header>

                <ul className="flex flex-col gap-2 p-2.5">
                  {layerNodes.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-[12px] text-muted-foreground">
                      Empty
                    </li>
                  ) : (
                    layerNodes.map((node, nodeIndex) => {
                      const Icon = iconFor(node.type)
                      const active = node.id === selectedNodeId
                      const meta = nodeMeta(node, isPromptChain)
                      const showReorder =
                        isPromptChain && node.type === "model" && onMoveNode
                      return (
                        <li key={node.id} className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() => onSelect(active ? null : node.id)}
                            className={cn(
                              "flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors",
                              active
                                ? "border-mm-charge/40 bg-white ring-2 ring-mm-charge/15"
                                : "border-transparent bg-white hover:border-mm-charge/25",
                            )}
                          >
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-mm-blue/6 font-data text-[11px] font-semibold text-mm-blue">
                              {isPromptChain && node.type === "model" ? (
                                nodeIndex + 1
                              ) : (
                                <Icon className="size-3.5" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-mm-dark">
                                {node.name}
                              </span>
                              {meta ? (
                                <span className="mt-0.5 block truncate font-data text-[11px] text-muted-foreground">
                                  {meta}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {showReorder ? (
                            <div className="flex flex-col justify-center gap-0.5">
                              <button
                                type="button"
                                aria-label="Move up"
                                disabled={nodeIndex === 0}
                                onClick={() => onMoveNode(node.id, -1)}
                                className="rounded-md p-1 text-muted-foreground hover:bg-white hover:text-mm-dark disabled:opacity-30"
                              >
                                <ChevronUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Move down"
                                disabled={nodeIndex === layerNodes.length - 1}
                                onClick={() => onMoveNode(node.id, 1)}
                                className="rounded-md p-1 text-muted-foreground hover:bg-white hover:text-mm-dark disabled:opacity-30"
                              >
                                <ChevronDown className="size-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </li>
                      )
                    })
                  )}
                  {isPromptChain && layer.type === "agents" && onAddAgent ? (
                    <li>
                      <button
                        type="button"
                        disabled={!canAddAgent}
                        onClick={onAddAgent}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 px-3 py-2.5 text-[12px] font-medium text-mm-dark hover:border-mm-charge/35 hover:bg-white disabled:opacity-40"
                      >
                        <Plus className="size-3.5" />
                        Add agent
                      </button>
                    </li>
                  ) : null}
                </ul>
              </section>

              {index < orderedLayers.length - 1 ? (
                <div
                  className="hidden shrink-0 items-center text-mm-blue/30 sm:flex"
                  aria-hidden
                >
                  <ArrowRight className="size-4" strokeWidth={1.75} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
