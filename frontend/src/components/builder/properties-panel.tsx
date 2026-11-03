import { Boxes, LockKeyhole, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  defaultModelForProvider,
  modelsForProvider,
} from "@/lib/provider-models"
import type {
  ConfigurationNode,
  ConfigurationNodeType,
  ModelProvider,
} from "@/types/configuration"

// Node types the backend runs as an LLM call
const LLM_NODE_TYPES: ConfigurationNodeType[] = [
  "model",
  "router",
  "parallel-controller",
  "evaluator",
  "aggregator",
]

const INHERIT = "inherit"

const PROVIDER_LABELS: Record<string, string> = {
  [INHERIT]: "Same as first agent",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  local: "Local",
}

const TOOL_OPTIONS = [
  { id: "calculator", label: "Calculator" },
  { id: "context_search", label: "Context search" },
]

interface Props {
  node?: ConfigurationNode
  canDelete: boolean
  onDelete: (nodeId: string) => void
  onUpdateModel: (
    nodeId: string,
    updates: {
      provider?: ModelProvider
      model?: string
      temperature?: number
      systemPrompt?: string
    },
  ) => void
  onUpdateInstructions: (nodeId: string, instructions: string) => void
  onUpdateMetadata: (
    nodeId: string,
    updates: NonNullable<ConfigurationNode["metadata"]>,
  ) => void
  onClearModel: (nodeId: string) => void
}

export default function PropertiesPanel({
  node,
  canDelete,
  onDelete,
  onUpdateModel,
  onUpdateInstructions,
  onUpdateMetadata,
  onClearModel,
}: Props) {
  const runsLlm = !!node && LLM_NODE_TYPES.includes(node.type)
  // Control nodes without settings inherit the first agent's model in the backend
  const inherits = runsLlm && node?.type !== "model" && !node?.modelSettings
  const provider = node?.modelSettings?.provider ?? "openai"
  const modelOptions = modelsForProvider(provider)
  const currentModel = node?.modelSettings?.model ?? ""
  const modelValue = modelOptions.some((option) => option.id === currentModel)
    ? currentModel
    : (modelOptions[0]?.id ?? "")

  return (
    <aside className="bg-white">
      <div className="border-b border-border/80 px-4 py-3.5">
        <p className="text-[13px] font-semibold text-mm-dark">Properties</p>
      </div>

      {!node ? (
        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
          <Boxes className="mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium text-mm-dark">Nothing selected</p>
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <div>
            <Label>Name</Label>
            <Input className="mt-2" value={node.name} readOnly />
          </div>

          {runsLlm ? (
            <>
              <div>
                <Label>Provider</Label>
                <Select
                  items={PROVIDER_LABELS}
                  value={inherits ? INHERIT : provider}
                  onValueChange={(value) => {
                    if (value === INHERIT) {
                      onClearModel(node.id)
                      return
                    }
                    const next = value as ModelProvider
                    onUpdateModel(node.id, {
                      provider: next,
                      model: defaultModelForProvider(next),
                    })
                  }}
                >
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {node.type !== "model" ? (
                      <SelectItem value={INHERIT}>Same as first agent</SelectItem>
                    ) : null}
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!inherits ? (
              <>
              <div>
                <Label>Model</Label>
                <Select
                  items={Object.fromEntries(
                    modelOptions.map((option) => [option.id, option.label]),
                  )}
                  value={modelValue}
                  onValueChange={(value) => {
                    if (value) onUpdateModel(node.id, { model: value })
                  }}
                >
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>System Prompt</Label>
                <Textarea
                  className="mt-2 min-h-28"
                  value={node.modelSettings?.systemPrompt ?? ""}
                  placeholder={
                    node.type === "model"
                      ? "Empty = dataset default prompt"
                      : "Optional extra guidance"
                  }
                  onChange={(event) =>
                    onUpdateModel(node.id, {
                      systemPrompt: event.target.value,
                    })
                  }
                />
              </div>
              </>
              ) : null}
            </>
          ) : null}

          {node.type === "tool" ? (
            <div>
              <Label>Tool</Label>
              <Select
                items={Object.fromEntries(
                  TOOL_OPTIONS.map((option) => [option.id, option.label]),
                )}
                value={
                  typeof node.metadata?.tool === "string"
                    ? node.metadata.tool
                    : "calculator"
                }
                onValueChange={(value) =>
                  onUpdateMetadata(node.id, { tool: value })
                }
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {node.type === "evaluator" ? (
            <div>
              <Label>Max rounds</Label>
              <Input
                className="mt-2"
                type="number"
                min={1}
                max={6}
                value={
                  typeof node.metadata?.maxRounds === "number"
                    ? node.metadata.maxRounds
                    : 3
                }
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value) && value >= 1) {
                    onUpdateMetadata(node.id, { maxRounds: Math.min(6, value) })
                  }
                }}
              />
            </div>
          ) : null}

          <div>
            <Label>Instructions</Label>
            <Textarea
              className="mt-2 min-h-24"
              value={node.metadata?.instructions ?? ""}
              onChange={(event) =>
                onUpdateInstructions(node.id, event.target.value)
              }
              placeholder="Instructions"
            />
          </div>

          <div className="border-t border-border pt-4">
            {canDelete ? (
              <Button
                variant="outline"
                className="w-full border-red-500/25 text-red-700 hover:border-red-500/40 hover:bg-red-50 hover:text-red-800"
                onClick={() => onDelete(node.id)}
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole className="size-3.5" />
                Required
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
