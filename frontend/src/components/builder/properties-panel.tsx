import { Boxes, ChevronDown, LockKeyhole, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

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
  defaultPromptStep,
  PROMPT_TEMPLATE_VARIABLES,
} from "@/lib/prompt-chain"
import {
  defaultRouterSettings,
  previewRouterPrompt,
  previewSpecialistPrompt,
  routeAgents,
} from "@/lib/routing"
import {
  DEFAULT_PROVIDER,
  defaultModelForProvider,
  isExecutableProvider,
  modelsForProvider,
} from "@/lib/provider-models"
import { cn } from "@/lib/utils"
import { useAgentPresets } from "@/hooks/use-agent-presets"
import { roleOptions } from "@/lib/prompt-chain"
import type {
  AgentConfiguration,
  ArchitectureType,
  ConfigurationNode,
  ConfigurationNodeType,
  ModelProvider,
  PromptChainOutputFormat,
  PromptChainPreviousOutputs,
  PromptChainRole,
  PromptStepSettings,
  RouterSettings,
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
  architecture?: ArchitectureType
  configuration?: AgentConfiguration
  canDelete: boolean
  onDelete: (nodeId: string) => void
  onUpdateName: (nodeId: string, name: string) => void
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
  onUpdatePromptStep: (
    nodeId: string,
    updates: Partial<PromptStepSettings>,
    options?: { applyRoleDefaults?: boolean },
  ) => void
  onUpdateRouterSettings?: (
    nodeId: string,
    updates: Partial<RouterSettings>,
  ) => void
}

export default function PropertiesPanel({
  node,
  architecture,
  configuration,
  canDelete,
  onDelete,
  onUpdateName,
  onUpdateModel,
  onUpdateInstructions,
  onUpdateMetadata,
  onClearModel,
  onUpdatePromptStep,
  onUpdateRouterSettings,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const presets = useAgentPresets()
  const roles = useMemo(() => roleOptions(presets), [presets])
  // A generic agent whose role matches a preset label shows that preset as chosen
  const presetValue =
    presets.find((p) => p.label === node?.metadata?.role)?.id ?? null
  const isChainAgent =
    architecture === "prompt-chaining" && node?.type === "model"
  const isRouteAgent = architecture === "routing" && node?.type === "model"
  const isRouterNode = architecture === "routing" && node?.type === "router"
  const isSpecialist = isChainAgent || isRouteAgent
  const runsLlm = !!node && LLM_NODE_TYPES.includes(node.type)
  // Control nodes without settings inherit the first agent's model in the backend
  const inherits = runsLlm && node?.type !== "model" && !node?.modelSettings
  const provider = node?.modelSettings?.provider ?? DEFAULT_PROVIDER
  const modelOptions = modelsForProvider(provider)
  const currentModel = node?.modelSettings?.model ?? ""
  const modelValue = modelOptions.some((option) => option.id === currentModel)
    ? currentModel
    : (modelOptions[0]?.id ?? "")
  const step = node ? defaultPromptStep(node) : defaultPromptStep()
  const routerSettings = {
    ...defaultRouterSettings(),
    ...node?.routerSettings,
  }
  const routePreview =
    configuration && isRouterNode
      ? previewRouterPrompt(configuration)
      : null
  const specialistPreview = node && isRouteAgent ? previewSpecialistPrompt(node) : null
  const routeOptions = configuration ? routeAgents(configuration) : []

  return (
    <aside className="bg-white">
      <div className="border-b border-border/80 px-4 py-3.5">
        <p className="text-[13px] font-semibold text-mm-dark">Properties</p>
      </div>

      {!node ? (
        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
          <Boxes className="mb-3 size-7 text-muted-foreground" />
          <p className="text-sm font-medium text-mm-dark">Nothing selected</p>
          {architecture === "prompt-chaining" ? (
            <p className="mt-1 max-w-[22ch] text-[12px] text-muted-foreground">
              Click an agent in the chain to edit its role, model, and inputs.
            </p>
          ) : architecture === "routing" ? (
            <p className="mt-1 max-w-[26ch] text-[12px] text-muted-foreground">
              Click the Router or a specialist to edit routing and prompts.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <div>
            <Label htmlFor="node-name">Name</Label>
            <Input
              id="node-name"
              className="mt-2"
              value={node.name}
              readOnly={!isSpecialist}
              onChange={(event) => onUpdateName(node.id, event.target.value)}
            />
          </div>

          {isRouterNode ? (
            <>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                The Router only chooses a specialist. It does not answer the task.
              </p>
              {node.modelSettings ? (
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
                    {!isExecutableProvider(provider) ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[#b34800]">
                        This provider is not supported yet. The Router will not run.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label>Model</Label>
                    <Select
                      value={modelValue}
                      onValueChange={(value) =>
                        onUpdateModel(node.id, { model: value ?? undefined })
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
                </>
              ) : null}
              <div>
                <Label htmlFor="router-instructions">Routing instructions</Label>
                <Textarea
                  id="router-instructions"
                  className="mt-2 min-h-20"
                  value={routerSettings.instructions ?? ""}
                  onChange={(event) =>
                    onUpdateRouterSettings?.(node.id, {
                      instructions: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>Fallback route id</Label>
                <Select
                  value={routerSettings.fallbackRouteId || "__none__"}
                  onValueChange={(value) => {
                    if (!value) return
                    onUpdateRouterSettings?.(node.id, {
                      fallbackRouteId: value === "__none__" ? "" : value,
                    })
                  }}
                >
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {routeOptions.map((route, index) => {
                      const id =
                        route.promptStep?.routeId?.trim() ||
                        String(route.promptStep?.role ?? `route-${index + 1}`)
                      return (
                        <SelectItem key={route.id} value={id}>
                          {id} ({route.name})
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              {routePreview ? (
                <div className="rounded-xl border border-border/70 bg-[#fafbfd] p-3">
                  <p className="text-[12px] font-medium text-mm-dark">
                    Prompt preview
                  </p>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap font-data text-[11px] text-muted-foreground">
                    {routePreview.system}
                  </pre>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap font-data text-[11px] text-muted-foreground">
                    {routePreview.user}
                  </pre>
                </div>
              ) : null}
            </>
          ) : null}

          {isSpecialist ? (
            <div>
              <Label>Role</Label>
              <Select
                items={Object.fromEntries(roles.map((r) => [r.id, r.label]))}
                value={String(step.role)}
                onValueChange={(value) => {
                  if (!value) return
                  onUpdatePromptStep(
                    node.id,
                    { role: value as PromptChainRole },
                    { applyRoleDefaults: true },
                  )
                }}
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {runsLlm && !isRouterNode ? (
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
                {(isChainAgent || isRouteAgent) && !isExecutableProvider(provider) ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#b34800]">
                    This provider is not supported yet. This step will not run.
                  </p>
                ) : null}
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

              {!isSpecialist ? (
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
              ) : null}
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

          {isSpecialist ? (
            <>
              {isRouteAgent ? (
                <>
                  <div>
                    <Label htmlFor="route-id">Route id</Label>
                    <Input
                      id="route-id"
                      className="mt-2 font-data"
                      value={step.routeId ?? ""}
                      onChange={(event) =>
                        onUpdatePromptStep(node.id, {
                          routeId: event.target.value,
                        })
                      }
                      placeholder="e.g. analyst"
                    />
                  </div>
                  <div>
                    <Label htmlFor="route-description">Routing description</Label>
                    <Textarea
                      id="route-description"
                      className="mt-2 min-h-20"
                      value={step.routeDescription ?? ""}
                      onChange={(event) =>
                        onUpdatePromptStep(node.id, {
                          routeDescription: event.target.value,
                        })
                      }
                      placeholder="When the Router should select this specialist"
                    />
                  </div>
                </>
              ) : null}
              <div>
                <Label htmlFor="chain-objective">Objective</Label>
                <Textarea
                  id="chain-objective"
                  className="mt-2 min-h-20"
                  value={step.objective}
                  onChange={(event) =>
                    onUpdatePromptStep(node.id, {
                      objective: event.target.value,
                    })
                  }
                  placeholder="What this agent should accomplish"
                />
              </div>

              <div>
                <Label htmlFor="chain-instructions">Instructions</Label>
                <Textarea
                  id="chain-instructions"
                  className="mt-2 min-h-24"
                  value={step.instructions}
                  onChange={(event) =>
                    onUpdatePromptStep(node.id, {
                      instructions: event.target.value,
                    })
                  }
                  placeholder="How it should work"
                />
              </div>

              {isChainAgent ? (
              <div>
                <p className="text-sm font-medium">Inputs</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Defaults to the original task plus the previous agent.
                </p>
                <label className="mt-2 flex items-center gap-2 rounded-xl border border-border/70 bg-[#fafbfd] px-3 py-2.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={step.inputs.task}
                    onChange={(event) =>
                      onUpdatePromptStep(node.id, {
                        inputs: {
                          ...step.inputs,
                          task: event.target.checked,
                        },
                      })
                    }
                  />
                  Original task
                </label>
                <div className="mt-2">
                  <Label>Previous outputs</Label>
                  <Select
                    value={step.inputs.previousOutputs}
                    onValueChange={(value) => {
                      if (!value) return
                      onUpdatePromptStep(node.id, {
                        inputs: {
                          ...step.inputs,
                          previousOutputs: value as PromptChainPreviousOutputs,
                        },
                      })
                    }}
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last">Previous step</SelectItem>
                      <SelectItem value="all">All previous steps</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              ) : null}

              {specialistPreview ? (
                <div className="rounded-xl border border-border/70 bg-[#fafbfd] p-3">
                  <p className="text-[12px] font-medium text-mm-dark">
                    Prompt preview
                  </p>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-data text-[11px] text-muted-foreground">
                    {specialistPreview.system}
                  </pre>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="flex w-full items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-left"
              >
                <span className="text-[12px] font-medium text-mm-dark">
                  Advanced
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    advancedOpen && "rotate-180",
                  )}
                />
              </button>

              {advancedOpen ? (
                <div className="space-y-4 rounded-xl border border-border/70 bg-[#fafbfd] p-3">
                  {isChainAgent ? (
                  <div>
                    <Label>Output format</Label>
                    <Select
                      value={step.outputFormat}
                      onValueChange={(value) => {
                        if (!value) return
                        onUpdatePromptStep(node.id, {
                          outputFormat: value as PromptChainOutputFormat,
                        })
                      }}
                    >
                      <SelectTrigger className="mt-2 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Plain text</SelectItem>
                        <SelectItem value="structured">
                          Structured JSON
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      Intermediate steps can pass facts, calculations, and
                      evidence as JSON. The final step always answers in text so
                      it can be scored.
                    </p>
                  </div>
                  ) : null}

                  <div>
                    <Label htmlFor="chain-template">Prompt template</Label>
                    <Textarea
                      id="chain-template"
                      className="mt-2 min-h-32 font-data text-[12px]"
                      value={step.promptTemplate}
                      onChange={(event) =>
                        onUpdatePromptStep(node.id, {
                          promptTemplate: event.target.value,
                        })
                      }
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      Variables:{" "}
                      {PROMPT_TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(
                        ", ",
                      )}
                      . Dataset instructions are added only on the last step.
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {node.type === "model" ? (
                <div>
                  <Label>Start from a preset</Label>
                  <Select
                    items={Object.fromEntries(presets.map((p) => [p.id, p.label]))}
                    value={presetValue}
                    onValueChange={(value) => {
                      const preset = presets.find((p) => p.id === value)
                      if (!preset) return
                      onUpdateMetadata(node.id, {
                        role: preset.label,
                        instructions: [preset.objective, preset.instructions].filter(Boolean).join("\n\n"),
                      })
                    }}
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue placeholder="Choose an agent preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    Fills the role and instructions below; edit them freely after.
                  </p>
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
            </>
          )}

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
