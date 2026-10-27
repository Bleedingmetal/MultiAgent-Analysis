"use client"

import {
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Combine,
  GitBranch,
  GitFork,
  Inbox,
  Link2,
  Plus,
  Repeat2,
  Send,
  Trash2,
  Wrench,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type {
  ConfigurationEdge,
  ConfigurationLayer,
  ConfigurationNode,
  ConfigurationNodeType,
  LayerType,
} from "@/types/configuration"

const ADDABLE_LAYER_TYPES: { type: LayerType; label: string }[] = [
  { type: "orchestration", label: "Orchestration" },
  { type: "agents", label: "Agents" },
  { type: "tools", label: "Tools" },
  { type: "aggregation", label: "Aggregation" },
]

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

function nodeName(
  nodes: ConfigurationNode[],
  id: string,
) {
  return nodes.find((node) => node.id === id)?.name ?? id
}

interface Props {
  layers: ConfigurationLayer[]
  nodes: ConfigurationNode[]
  edges: ConfigurationEdge[]
  selectedNodeId: string | null
  selectedLayerId: string | null
  linkSourceId: string | null
  onSelectNode: (nodeId: string | null) => void
  onSelectLayer: (layerId: string | null) => void
  onMoveLayer: (layerId: string, direction: -1 | 1) => void
  onRemoveLayer: (layerId: string) => void
  onAddLayer: (type: LayerType) => void
  onStartLink: (nodeId: string) => void
  onCancelLink: () => void
  onRemoveEdge: (edgeId: string) => void
}

export default function CustomPipeline({
  layers,
  nodes,
  edges,
  selectedNodeId,
  selectedLayerId,
  linkSourceId,
  onSelectNode,
  onSelectLayer,
  onMoveLayer,
  onRemoveLayer,
  onAddLayer,
  onStartLink,
  onCancelLink,
  onRemoveEdge,
}: Props) {
  const orderedLayers = layers.slice().sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/80 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
          <p className="text-[13px] font-semibold text-mm-dark">Custom</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {ADDABLE_LAYER_TYPES.map((entry) => (
              <button
                key={entry.type}
                type="button"
                onClick={() => onAddLayer(entry.type)}
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] font-medium text-mm-dark hover:border-mm-charge/35 hover:bg-[#f7f9fc]"
              >
                <Plus className="size-3" />
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {linkSourceId ? (
          <div className="flex items-center justify-between gap-3 border-b border-mm-charge/20 bg-mm-charge/5 px-4 py-2.5">
            <p className="text-[12px] font-medium text-mm-blue">
              Linking from {nodeName(nodes, linkSourceId)} — click a target
            </p>
            <button
              type="button"
              onClick={onCancelLink}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-white"
            >
              <X className="size-3.5" />
              Cancel
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto p-4">
          <div className="flex min-w-max items-stretch gap-2">
            {orderedLayers.map((layer, index) => {
              const layerNodes = nodes
                .filter((node) => node.layerId === layer.id)
                .sort((a, b) => a.order - b.order)
              const locked = layer.type === "input" || layer.type === "output"
              const layerActive = layer.id === selectedLayerId

              return (
                <div
                  key={layer.id}
                  className="flex items-stretch gap-2"
                >
                  <section
                    className={cn(
                      "flex w-[200px] flex-col rounded-xl border bg-[#f7f9fc]",
                      layerActive
                        ? "border-mm-charge/40 ring-2 ring-mm-charge/10"
                        : "border-border/80",
                    )}
                  >
                    <header className="border-b border-border/60 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSelectLayer(layer.id)}
                        className="w-full text-left"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mm-blue">
                          {layer.name}
                        </p>
                      </button>
                      <div className="mt-1.5 flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Move left"
                          disabled={index === 0}
                          onClick={() => onMoveLayer(layer.id, -1)}
                          className="rounded p-1 text-muted-foreground hover:bg-white disabled:opacity-30"
                        >
                          <ChevronLeft className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move right"
                          disabled={index === orderedLayers.length - 1}
                          onClick={() => onMoveLayer(layer.id, 1)}
                          className="rounded p-1 text-muted-foreground hover:bg-white disabled:opacity-30"
                        >
                          <ChevronRight className="size-3.5" />
                        </button>
                        {!locked ? (
                          <button
                            type="button"
                            aria-label="Remove layer"
                            onClick={() => onRemoveLayer(layer.id)}
                            className="ml-auto rounded p-1 text-muted-foreground hover:bg-white hover:text-red-700"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </header>

                    <ul className="flex flex-1 flex-col gap-2 p-2.5">
                      {layerNodes.length === 0 ? (
                        <li className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-[12px] text-muted-foreground">
                          Empty
                        </li>
                      ) : (
                        layerNodes.map((node) => {
                          const Icon = iconFor(node.type)
                          const active = node.id === selectedNodeId
                          const linking = node.id === linkSourceId
                          const meta = nodeMeta(node)
                          return (
                            <li key={node.id}>
                              <div
                                className={cn(
                                  "rounded-lg border bg-white",
                                  active || linking
                                    ? "border-mm-charge/40 ring-2 ring-mm-charge/15"
                                    : "border-transparent",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSelectNode(active ? null : node.id)
                                  }
                                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
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
                                <div className="flex border-t border-border/50 px-1.5 py-1">
                                  <button
                                    type="button"
                                    onClick={() => onStartLink(node.id)}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                                      linking
                                        ? "bg-mm-charge/10 text-mm-blue"
                                        : "text-muted-foreground hover:bg-[#f7f9fc] hover:text-mm-dark",
                                    )}
                                  >
                                    <Link2 className="size-3" />
                                    Link
                                  </button>
                                </div>
                              </div>
                            </li>
                          )
                        })
                      )}
                    </ul>
                  </section>

                  {index < orderedLayers.length - 1 ? (
                    <div
                      className="flex items-center text-mm-blue/30"
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
      </div>

      <div className="rounded-2xl border border-border/80 bg-white">
        <div className="border-b border-border/70 px-4 py-3">
          <p className="text-[13px] font-semibold text-mm-dark">Edges</p>
        </div>
        {edges.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-muted-foreground">None</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {edges.map((edge) => (
              <li
                key={edge.id}
                className="flex items-center gap-2 px-4 py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-mm-dark">
                  {nodeName(nodes, edge.source)}
                  <span className="mx-2 text-muted-foreground">→</span>
                  {nodeName(nodes, edge.target)}
                  {edge.label ? (
                    <span className="ml-2 text-muted-foreground">
                      ({edge.label})
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveEdge(edge.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-[#f7f9fc] hover:text-red-700"
                  aria-label="Remove edge"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
