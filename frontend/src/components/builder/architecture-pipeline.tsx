"use client"

import {
  ArrowRight,
  Bot,
  Combine,
  GitBranch,
  GitFork,
  Inbox,
  Repeat2,
  Send,
  Wrench,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type {
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

function nodeMeta(node: ConfigurationNode) {
  if (node.type === "model" && node.modelSettings) {
    return node.modelSettings.model
  }
  return null
}

interface Props {
  layers: ConfigurationLayer[]
  nodes: ConfigurationNode[]
  selectedNodeId: string | null
  onSelect: (nodeId: string | null) => void
}

export default function ArchitecturePipeline({
  layers,
  nodes,
  selectedNodeId,
  onSelect,
}: Props) {
  const orderedLayers = layers.slice().sort((a, b) => a.order - b.order)

  return (
    <div className="rounded-2xl border border-border/80 bg-white">
      <div className="border-b border-border/70 px-5 py-3.5">
        <p className="text-[13px] font-semibold text-mm-dark">Pipeline</p>
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
                    layerNodes.map((node) => {
                      const Icon = iconFor(node.type)
                      const active = node.id === selectedNodeId
                      const meta = nodeMeta(node)
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(active ? null : node.id)}
                            className={cn(
                              "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors",
                              active
                                ? "border-mm-charge/40 bg-white ring-2 ring-mm-charge/15"
                                : "border-transparent bg-white hover:border-mm-charge/25",
                            )}
                          >
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-mm-blue/6 text-mm-blue">
                              <Icon className="size-3.5" />
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
                        </li>
                      )
                    })
                  )}
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
