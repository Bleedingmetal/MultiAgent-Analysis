/**
 * Agent presets: the reusable prompts behind the Researcher / Analyst / Verifier roles,
 * plus any custom agents the team adds. Edited on the Agent prompts page; used by the
 * builder whenever a role is chosen, and by any agent through the Preset picker.
 *
 * Built-in presets can be edited (an override is stored) and reset. Custom presets are
 * stored whole. Everything lives in localStorage, like saved configurations.
 */

import type { PromptChainOutputFormat } from "@/types/configuration"

export type AgentPreset = {
  id: string
  label: string
  /** One line: what this agent is for. Shown in pickers. */
  description: string
  objective: string
  instructions: string
  promptTemplate: string
  outputFormat: PromptChainOutputFormat
  builtIn: boolean
  updatedAt?: string
}

export const DEFAULT_PROMPT_TEMPLATE = [
  "Your role in this sequential chain of agents: {{role}}.",
  "",
  "Objective: {{objective}}",
  "",
  "{{instructions}}",
  "",
  "{{output_requirements}}",
].join("\n")

export const PROMPT_TEMPLATE_VARIABLES = [
  "role",
  "objective",
  "instructions",
  "output_requirements",
  "dataset_instructions",
] as const

export const BUILT_IN_PRESETS: AgentPreset[] = [
  {
    id: "researcher",
    label: "Researcher",
    description: "Extracts the facts and figures the task needs from the source material.",
    objective:
      "Extract the facts, figures, and evidence needed to answer the task. Do not invent values.",
    instructions:
      "Work only from the provided inputs. Quote quantities with their units. Note anything that is missing or ambiguous.",
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    outputFormat: "structured",
    builtIn: true,
  },
  {
    id: "analyst",
    label: "Analyst",
    description: "Derives the answer from the evidence, showing each calculation.",
    objective:
      "Use the extracted evidence to compute or derive the answer required by the task.",
    instructions:
      "Show each calculation as `expression = result`. Do not introduce facts that were not in the inputs.",
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    outputFormat: "structured",
    builtIn: true,
  },
  {
    id: "verifier",
    label: "Verifier",
    description: "Checks the previous work and commits to the final answer.",
    objective:
      "Check the previous agent's work and produce the final answer to the original task.",
    instructions:
      "Confirm or correct the calculations. If something is unsupported, say so. Keep the final answer concise.",
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    outputFormat: "text",
    builtIn: true,
  },
]

const STORAGE_KEY = "massmutual-agent-presets-v1"
export const PRESETS_CHANGED_EVENT = "agent-presets-changed"

type Stored = {
  overrides: Record<string, Partial<AgentPreset>>
  custom: AgentPreset[]
}

function readStored(): Stored {
  if (typeof window === "undefined") return { overrides: {}, custom: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { overrides: {}, custom: [] }
    const parsed = JSON.parse(raw) as Partial<Stored>
    return {
      overrides: parsed.overrides ?? {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    }
  } catch {
    return { overrides: {}, custom: [] }
  }
}

function writeStored(stored: Stored) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    window.dispatchEvent(new Event(PRESETS_CHANGED_EVENT))
  } catch {
    /* storage unavailable: the edit lives for this page only */
  }
}

/** Built-ins (with any edits applied) followed by custom presets. */
export function getPresets(): AgentPreset[] {
  const stored = readStored()
  const builtIn = BUILT_IN_PRESETS.map((p) => ({ ...p, ...stored.overrides[p.id], id: p.id, builtIn: true }))
  return [...builtIn, ...stored.custom.map((p) => ({ ...p, builtIn: false }))]
}

export function getPreset(id: string): AgentPreset | undefined {
  return getPresets().find((p) => p.id === id)
}

/** True when a built-in preset differs from what ships with the app. */
export function isOverridden(id: string) {
  return Boolean(readStored().overrides[id])
}

export function savePreset(preset: AgentPreset): AgentPreset {
  const stored = readStored()
  const next = { ...preset, updatedAt: new Date().toISOString() }
  if (preset.builtIn) {
    const base = BUILT_IN_PRESETS.find((p) => p.id === preset.id)
    if (!base) throw new Error(`Unknown built-in preset ${preset.id}`)
    const { label, description, objective, instructions, promptTemplate, outputFormat, updatedAt } = next
    stored.overrides[preset.id] = { label, description, objective, instructions, promptTemplate, outputFormat, updatedAt }
  } else {
    const i = stored.custom.findIndex((p) => p.id === preset.id)
    if (i >= 0) stored.custom[i] = next
    else stored.custom.push(next)
  }
  writeStored(stored)
  return next
}

export function resetPreset(id: string) {
  const stored = readStored()
  delete stored.overrides[id]
  writeStored(stored)
}

export function deletePreset(id: string) {
  const stored = readStored()
  stored.custom = stored.custom.filter((p) => p.id !== id)
  writeStored(stored)
}

export function newPresetId(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"
  const taken = new Set(getPresets().map((p) => p.id))
  let id = slug
  let n = 2
  while (taken.has(id) || id === "custom") id = `${slug}-${n++}`
  return id
}

export function blankPreset(): AgentPreset {
  return {
    id: "",
    label: "",
    description: "",
    objective: "",
    instructions: "",
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    outputFormat: "text",
    builtIn: false,
  }
}

/** The system prompt a chain step built from this preset would send, for preview. */
export function renderPresetPrompt(preset: AgentPreset, options?: { last?: boolean }) {
  const fill: Record<string, string> = {
    role: preset.label || "Custom",
    objective: preset.objective,
    instructions: preset.instructions,
    output_requirements: options?.last
      ? "Respond in plain text; put the final answer on the last line."
      : preset.outputFormat === "structured"
        ? "Respond as JSON with summary, facts, calculations, evidence and answer, so the next agent can read it."
        : "Respond in plain text. Keep it concise and self-contained, because the next agent will read it.",
    dataset_instructions: options?.last
      ? "(the dataset's own instructions and answer format are added here on the last step)"
      : "",
  }
  let text = (preset.promptTemplate || DEFAULT_PROMPT_TEMPLATE).replace(
    /\{\{\s*([a-z_]+)\s*\}\}/gi,
    (_, key: string) => fill[key] ?? "",
  )
  // Fields the template left out are still sent, so a user can't lose them by editing it
  if (preset.objective && !/\{\{\s*objective/.test(preset.promptTemplate)) text += `\n\nObjective:\n${preset.objective}`
  if (preset.instructions && !/\{\{\s*instructions/.test(preset.promptTemplate)) text += `\n\nInstructions:\n${preset.instructions}`
  return text.replace(/\n{3,}/g, "\n\n").trim()
}
