import { useCallback, useState } from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"

import {
  Bot,
  Boxes,
  GitBranch,
  GitFork,
  Layers3,
  Plus,
  Repeat2,
  Save,
  Sparkles,
  Workflow,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type PaletteItem = {
  label: string
  category: "model" | "architecture"
  subtype: string
}

const modelItems: PaletteItem[] = [
  {
    label: "GPT",
    category: "model",
    subtype: "gpt",
  },
  {
    label: "Claude",
    category: "model",
    subtype: "claude",
  },
  {
    label: "Gemini",
    category: "model",
    subtype: "gemini",
  },
]

const architectureItems: PaletteItem[] = [
  {
    label: "Prompt Chaining",
    category: "architecture",
    subtype: "prompt-chain",
  },
  {
    label: "Routing",
    category: "architecture",
    subtype: "routing",
  },
  {
    label: "Parallelization",
    category: "architecture",
    subtype: "parallel",
  },
  {
    label: "Evaluator-Optimizer",
    category: "architecture",
    subtype: "evaluator",
  },
  {
    label: "Autonomous Agent",
    category: "architecture",
    subtype: "agent",
  },
]

const initialNodes: Node[] = [
  {
    id: "prompt",
    position: {
      x: 100,
      y: 220,
    },
    data: {
      label: "Standard Task Prompt",
      category: "input",
    },
    style: {
      background: "#18181a",
      border: "1px solid #333336",
      color: "#f5f5f5",
      borderRadius: "10px",
      padding: "12px 18px",
    },
  },
  {
    id: "model",
    position: {
      x: 390,
      y: 220,
    },
    data: {
      label: "GPT",
      category: "model",
    },
    style: {
      background: "#002e6b",
      border: "1px solid #0265ff",
      color: "#ffffff",
      borderRadius: "10px",
      padding: "12px 18px",
    },
  },
  {
    id: "output",
    position: {
      x: 670,
      y: 220,
    },
    data: {
      label: "Final Answer",
      category: "output",
    },
    style: {
      background: "#18181a",
      border: "1px solid #333336",
      color: "#f5f5f5",
      borderRadius: "10px",
      padding: "12px 18px",
    },
  },
]

const initialEdges: Edge[] = [
  {
    id: "prompt-model",
    source: "prompt",
    target: "model",
  },
  {
    id: "model-output",
    source: "model",
    target: "output",
  },
]

function PaletteCard({
  item,
}: {
  item: PaletteItem
}) {
  function handleDragStart(
    event: React.DragEvent<HTMLDivElement>,
  ) {
    event.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify(item),
    )

    event.dataTransfer.effectAllowed = "move"
  }

  const Icon =
    item.category === "model"
      ? Bot
      : item.subtype === "routing"
        ? GitBranch
        : item.subtype === "parallel"
          ? GitFork
          : item.subtype === "evaluator"
            ? Repeat2
            : item.subtype === "agent"
              ? Sparkles
              : Workflow

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="
        group flex cursor-grab items-center gap-3 rounded-lg
        border border-border bg-card px-3 py-2.5
        transition hover:border-[#0265ff]/60 hover:bg-muted
        active:cursor-grabbing
      "
    >
      <div className="flex size-8 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4 text-muted-foreground group-hover:text-[#4dc7eb]" />
      </div>

      <span className="text-sm font-medium">
        {item.label}
      </span>
    </div>
  )
}

function ConfigurationCanvas() {
  const [nodes, setNodes] =
    useState<Node[]>(initialNodes)

  const [edges, setEdges] =
    useState<Edge[]>(initialEdges)

  const [selectedNode, setSelectedNode] =
    useState<Node | null>(null)

  const { screenToFlowPosition } = useReactFlow()

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((currentNodes) =>
        applyNodeChanges(changes, currentNodes),
      )
    },
    [],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((currentEdges) =>
        applyEdgeChanges(changes, currentEdges),
      )
    },
    [],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(connection, currentEdges),
      )
    },
    [],
  )

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
    },
    [],
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()

      const raw = event.dataTransfer.getData(
        "application/reactflow",
      )

      if (!raw) {
        return
      }

      const item: PaletteItem = JSON.parse(raw)

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode: Node = {
        id: crypto.randomUUID(),
        position,
        data: {
          label: item.label,
          category: item.category,
          subtype: item.subtype,
        },
        style: {
          background:
            item.category === "model"
              ? "#002e6b"
              : "#18181a",
          border:
            item.category === "model"
              ? "1px solid #0265ff"
              : "1px solid #333336",
          color: "#ffffff",
          borderRadius: "10px",
          padding: "12px 18px",
        },
      }

      setNodes((currentNodes) => [
        ...currentNodes,
        newNode,
      ])
    },
    [screenToFlowPosition],
  )

  return (
    <div className="grid min-h-[calc(100vh-7rem)] grid-cols-[230px_minmax(0,1fr)_290px] overflow-hidden rounded-xl border bg-background">

      {/* LEFT PALETTE */}

      <aside className="border-r bg-[#111112]">
        <ScrollArea className="h-full">
          <div className="p-4">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Components
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Drag components onto the canvas.
              </p>
            </div>

            <div className="space-y-6">
              <section>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Models
                </p>

                <div className="space-y-2">
                  {modelItems.map((item) => (
                    <PaletteCard
                      key={item.label}
                      item={item}
                    />
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Orchestration
                </p>

                <div className="space-y-2">
                  {architectureItems.map((item) => (
                    <PaletteCard
                      key={item.label}
                      item={item}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* CENTER CANVAS */}

      <section className="relative bg-[#0d0d0e]">
        <div className="absolute left-4 top-4 z-10 flex gap-2">
          <Badge variant="outline">
            Unsaved Configuration
          </Badge>

          <Badge
            variant="outline"
            className="border-[#0265ff]/40 text-[#4dc7eb]"
          >
            Single Agent
          </Badge>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={(_, node) =>
            setSelectedNode(node)
          }
          onPaneClick={() =>
            setSelectedNode(null)
          }
          fitView
          colorMode="dark"
        >
          <Background
            gap={24}
            size={1}
            color="#29292d"
          />

          <Controls />
        </ReactFlow>
      </section>

      {/* RIGHT PROPERTIES */}

      <aside className="border-l bg-[#111112]">
        <div className="border-b p-4">
          <p className="text-sm font-semibold">
            Properties
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Configure the selected component.
          </p>
        </div>

        <div className="space-y-5 p-4">
          {selectedNode ? (
            <>
              <div>
                <Label>Component Name</Label>

                <Input
                  className="mt-2"
                  value={String(
                    selectedNode.data.label,
                  )}
                  readOnly
                />
              </div>

              {selectedNode.data.category ===
                "model" && (
                <>
                  <div>
                    <Label>Model</Label>

                    <Select defaultValue="gpt">
                      <SelectTrigger className="mt-2 w-full">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="gpt">
                          GPT
                        </SelectItem>

                        <SelectItem value="claude">
                          Claude
                        </SelectItem>

                        <SelectItem value="gemini">
                          Gemini
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Temperature</Label>

                    <Input
                      className="mt-2"
                      type="number"
                      defaultValue="0.2"
                      min="0"
                      max="2"
                      step="0.1"
                    />
                  </div>
                </>
              )}

              <div>
                <Label>System Prompt</Label>

                <Textarea
                  className="mt-2 min-h-28"
                  placeholder="Optional node-specific instructions..."
                />
              </div>
            </>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <Boxes className="mb-3 size-8 text-muted-foreground" />

              <p className="text-sm font-medium">
                Nothing selected
              </p>

              <p className="mt-1 max-w-44 text-xs text-muted-foreground">
                Select a component on the canvas to configure it.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export default function Configurations() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Configuration Builder
            </h1>

            <Badge variant="secondary">
              Draft
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Build and compare model orchestration architectures.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            New
          </Button>

          <Button>
            <Save data-icon="inline-start" />
            Save Configuration
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-card p-2">
        <span className="px-2 text-xs text-muted-foreground">
          Templates
        </span>

        {[
          "Single Agent",
          "Prompt Chain",
          "Routing",
          "Parallel",
          "Evaluator",
          "Autonomous",
        ].map((template) => (
          <Button
            key={template}
            variant="ghost"
            size="sm"
          >
            {template}
          </Button>
        ))}
      </div>

      <ReactFlowProvider>
        <ConfigurationCanvas />
      </ReactFlowProvider>
    </div>
  )
}