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
import type { ConfigurationNode, ModelProvider } from "@/types/configuration"

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
}

export default function PropertiesPanel({
  node,
  canDelete,
  onDelete,
  onUpdateModel,
  onUpdateInstructions,
}: Props) {
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

          {node.type === "model" && node.modelSettings ? (
            <>
              <div>
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(value) => {
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
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Model</Label>
                <Select
                  value={modelValue}
                  onValueChange={(value) =>
                    onUpdateModel(node.id, { model: value })
                  }
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
                  value={node.modelSettings.systemPrompt ?? ""}
                  onChange={(event) =>
                    onUpdateModel(node.id, {
                      systemPrompt: event.target.value,
                    })
                  }
                />
              </div>
            </>
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
