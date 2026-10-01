import {
  Boxes,
  LockKeyhole,
  Trash2,
} from "lucide-react"

import type {
  ConfigurationNode,
  ModelProvider,
} from "@/types/configuration"

import {
  Button,
} from "@/components/ui/button"

import {
  Input,
} from "@/components/ui/input"

import {
  Label,
} from "@/components/ui/label"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  Textarea,
} from "@/components/ui/textarea"

interface Props {
  node?: ConfigurationNode

  canDelete: boolean

  onDelete: (
    nodeId: string,
  ) => void

  onUpdateModel: (
    nodeId: string,

    updates: {
      provider?: ModelProvider
      model?: string
      temperature?: number
      systemPrompt?: string
    },
  ) => void

  onUpdateInstructions: (
    nodeId: string,
    instructions: string,
  ) => void
}

export default function PropertiesPanel({
  node,
  canDelete,
  onDelete,
  onUpdateModel,
  onUpdateInstructions,
}: Props) {
  return (
    <aside className="border-l bg-[#111112]">
      <div className="border-b p-4">
        <p className="text-sm font-semibold">
          Properties
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Configure the selected component.
        </p>
      </div>

      {!node ? (
        <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
          <Boxes className="mb-3 size-8 text-muted-foreground" />

          <p className="text-sm font-medium">
            Nothing selected
          </p>

          <p className="mt-1 max-w-44 text-xs text-muted-foreground">
            Select a component on the canvas.
          </p>
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <div>
            <Label>
              Name
            </Label>

            <Input
              className="mt-2"
              value={
                node.name
              }
              readOnly
            />
          </div>

          <div>
            <Label>
              Type
            </Label>

            <Input
              className="mt-2"
              value={
                node.type
              }
              readOnly
            />
          </div>

          {node.type ===
            "model" &&
            node.modelSettings && (
              <>
                <div>
                  <Label>
                    Provider
                  </Label>

                  <Select
                    value={
                      node
                        .modelSettings
                        .provider
                    }

                    onValueChange={(
                      value,
                    ) =>
                      onUpdateModel(
                        node.id,
                        {
                          provider:
                            value as ModelProvider,
                        },
                      )
                    }
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="openai">
                        OpenAI
                      </SelectItem>

                      <SelectItem value="anthropic">
                        Anthropic
                      </SelectItem>

                      <SelectItem value="google">
                        Google
                      </SelectItem>

                      <SelectItem value="local">
                        Local
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>
                    Model
                  </Label>

                  <Input
                    className="mt-2"

                    value={
                      node
                        .modelSettings
                        .model
                    }

                    onChange={(
                      event,
                    ) =>
                      onUpdateModel(
                        node.id,
                        {
                          model:
                            event
                              .target
                              .value,
                        },
                      )
                    }
                  />
                </div>

                <div>
                  <Label>
                    Temperature
                  </Label>

                  <Input
                    className="mt-2"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}

                    value={
                      node
                        .modelSettings
                        .temperature ??
                      0.2
                    }

                    onChange={(
                      event,
                    ) =>
                      onUpdateModel(
                        node.id,
                        {
                          temperature:
                            Number(
                              event
                                .target
                                .value,
                            ),
                        },
                      )
                    }
                  />
                </div>

                <div>
                  <Label>
                    System Prompt
                  </Label>

                  <Textarea
                    className="mt-2 min-h-28"

                    value={
                      node
                        .modelSettings
                        .systemPrompt ??
                      ""
                    }

                    onChange={(
                      event,
                    ) =>
                      onUpdateModel(
                        node.id,
                        {
                          systemPrompt:
                            event
                              .target
                              .value,
                        },
                      )
                    }
                  />
                </div>
              </>
            )}

          <div>
            <Label>
              Instructions
            </Label>

            <Textarea
              className="mt-2 min-h-24"

              value={
                node.metadata
                  ?.instructions ??
                ""
              }

              onChange={(
                event,
              ) =>
                onUpdateInstructions(
                  node.id,
                  event
                    .target
                    .value,
                )
              }

              placeholder="Optional component-specific instructions..."
            />
          </div>

          <div className="border-t border-[#2d2d31] pt-4">
            {canDelete ? (
              <Button
                variant="outline"

                className="
                  w-full
                  border-red-500/30
                  text-red-400
                  hover:border-red-500/50
                  hover:bg-red-500/10
                  hover:text-red-300
                "

                onClick={() =>
                  onDelete(
                    node.id,
                  )
                }
              >
                <Trash2 data-icon="inline-start" />

                Delete Component
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole className="size-3.5" />

                Required architecture component
              </div>
            )}

            {canDelete && (
              <p className="mt-2 text-center text-[10px] text-zinc-600">
                Backspace or Delete
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}