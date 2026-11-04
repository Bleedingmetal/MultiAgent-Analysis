"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"

import { useAgentPresets } from "@/hooks/use-agent-presets"
import {
  type AgentPreset,
  BUILT_IN_PRESETS,
  DEFAULT_PROMPT_TEMPLATE,
  PROMPT_TEMPLATE_VARIABLES,
  blankPreset,
  deletePreset,
  isOverridden,
  newPresetId,
  renderPresetPrompt,
  resetPreset,
  savePreset,
} from "@/lib/agent-presets"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const card = "rounded-lg border border-[#e3e8ef] bg-white"

export default function AgentPromptsPage() {
  const presets = useAgentPresets()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentPreset | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Select the first preset once the library is loaded
  useEffect(() => {
    if (!selectedId && presets.length) setSelectedId(presets[0].id)
  }, [presets, selectedId])

  const selected = useMemo(
    () => presets.find((p) => p.id === selectedId) ?? null,
    [presets, selectedId],
  )

  // A fresh draft whenever a different preset is chosen
  useEffect(() => {
    if (selectedId === "__new__") return
    setDraft(selected ? { ...selected } : null)
    setSaved(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // The same preset changed elsewhere (another tab, a reset): refresh an untouched draft
  useEffect(() => {
    if (selectedId === "__new__" || !selected) return
    setDraft((d) => {
      if (!d || d.id !== selected.id) return d
      const same = (x: AgentPreset) => JSON.stringify({ ...x, updatedAt: 0 })
      return same(d) === same(selected) ? d : d.updatedAt === selected.updatedAt ? d : { ...selected }
    })
  }, [selected, selectedId])

  const dirty = Boolean(
    draft && selected && JSON.stringify({ ...draft, updatedAt: 0 }) !== JSON.stringify({ ...selected, updatedAt: 0 }),
  )
  const isNew = selectedId === "__new__"
  const overridden = selected?.builtIn ? isOverridden(selected.id) : false

  function startNew() {
    setSelectedId("__new__")
    setDraft(blankPreset())
    setSaved(null)
    setError(null)
  }

  function update<K extends keyof AgentPreset>(key: K, value: AgentPreset[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setSaved(null)
  }

  function save() {
    if (!draft) return
    if (!draft.label.trim()) {
      setError("Give the agent a name.")
      return
    }
    const toSave = isNew ? { ...draft, id: newPresetId(draft.label), builtIn: false } : draft
    const result = savePreset(toSave)
    setSelectedId(result.id)
    setDraft({ ...result })
    setSaved(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)
    setError(null)
  }

  function reset() {
    if (!selected?.builtIn) return
    resetPreset(selected.id)
    const base = BUILT_IN_PRESETS.find((p) => p.id === selected.id)
    if (base) setDraft({ ...base })
    setSaved("Reset to the built-in prompt")
  }

  function remove() {
    if (!selected || selected.builtIn) return
    if (!window.confirm(`Delete the "${selected.label}" preset? Configurations already using it keep their copy.`)) return
    deletePreset(selected.id)
    setSelectedId(presets[0]?.id ?? null)
  }

  const builtIn = presets.filter((p) => p.builtIn)
  const custom = presets.filter((p) => !p.builtIn)
  const preview = draft ? renderPresetPrompt(draft) : ""

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Agent prompts</h2>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black"
        >
          <Plus className="size-3.5" weight="bold" />
          New agent
        </button>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* The library */}
        <nav className={cn(card, "overflow-hidden")} aria-label="Agent presets">
          <p className="px-4 pt-4 pb-1 text-[12px] text-muted-foreground">Built in</p>
          <ul>
            {builtIn.map((p) => (
              <PresetRow key={p.id} preset={p} active={p.id === selectedId} onPick={() => setSelectedId(p.id)} edited={isOverridden(p.id)} />
            ))}
          </ul>
          <p className="px-4 pt-4 pb-1 text-[12px] text-muted-foreground">Custom</p>
          {custom.length ? (
            <ul className="pb-2">
              {custom.map((p) => (
                <PresetRow key={p.id} preset={p} active={p.id === selectedId} onPick={() => setSelectedId(p.id)} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted-foreground">None yet.</p>
          )}
          {isNew ? (
            <div className="border-t border-[#eef1f5] px-4 py-3 text-[13px] font-medium text-mm-dark">
              New agent (unsaved)
            </div>
          ) : null}
        </nav>

        {/* The editor */}
        {draft ? (
          <section className={cn(card, "min-w-0")}>
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-4">
              <h3 className="text-[16px] font-semibold text-mm-dark">
                {isNew ? "New agent" : draft.label}
                {draft.builtIn ? <span className="ml-2 text-[12px] font-normal text-muted-foreground">built in</span> : null}
              </h3>
              <span className="text-[12px] text-muted-foreground">
                {saved ?? (dirty ? "Unsaved changes" : "")}
              </span>
            </div>

            <div className="grid gap-5 px-5 py-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="preset-label">Name</Label>
                  <Input
                    id="preset-label"
                    className="mt-2"
                    value={draft.label}
                    onChange={(e) => update("label", e.target.value)}
                    placeholder="e.g. Fact checker"
                  />
                </div>
                <div>
                  <Label htmlFor="preset-description">What it is for</Label>
                  <Input
                    id="preset-description"
                    className="mt-2"
                    value={draft.description}
                    onChange={(e) => update("description", e.target.value)}
                    placeholder="One line, shown when choosing an agent"
                  />
                </div>
                <div>
                  <Label htmlFor="preset-objective">Objective</Label>
                  <Textarea
                    id="preset-objective"
                    className="mt-2 min-h-24"
                    value={draft.objective}
                    onChange={(e) => update("objective", e.target.value)}
                    placeholder="What this agent must accomplish"
                  />
                </div>
                <div>
                  <Label htmlFor="preset-instructions">Instructions</Label>
                  <Textarea
                    id="preset-instructions"
                    className="mt-2 min-h-56"
                    value={draft.instructions}
                    onChange={(e) => update("instructions", e.target.value)}
                    placeholder="How it should work. Be as detailed as you like: rules, what to check, what to refuse, how to lay out its answer."
                  />
                </div>
                <div>
                  <Label htmlFor="preset-format">Output between agents</Label>
                  <select
                    id="preset-format"
                    value={draft.outputFormat}
                    onChange={(e) => update("outputFormat", e.target.value as AgentPreset["outputFormat"])}
                    className="mt-2 h-9 w-full rounded-md border border-[#d1d7e0] bg-white px-3 text-[13px] text-mm-dark"
                  >
                    <option value="text">Plain text</option>
                    <option value="structured">Structured JSON (facts, calculations, evidence)</option>
                  </select>
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    The last agent in a chain always answers in plain text so it can be scored.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="preset-template">Prompt template</Label>
                  <Textarea
                    id="preset-template"
                    className="mt-2 min-h-40 font-data text-[13px]"
                    value={draft.promptTemplate}
                    onChange={(e) => update("promptTemplate", e.target.value)}
                  />
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    Variables: {PROMPT_TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}.
                    {draft.promptTemplate !== DEFAULT_PROMPT_TEMPLATE ? (
                      <button type="button" className="ml-1 text-mm-charge hover:underline" onClick={() => update("promptTemplate", DEFAULT_PROMPT_TEMPLATE)}>
                        Use the default template
                      </button>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-mm-dark">System prompt the agent will receive</p>
                  <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-[#eef1f5] bg-[#f7f9fc] px-3 py-2.5 font-data text-[13px] leading-relaxed text-mm-dark">
                    {preview || "Fill in the objective and instructions to see the prompt."}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f5] px-5 py-4">
              <button
                type="button"
                onClick={save}
                disabled={!dirty && !isNew}
                className="inline-flex h-9 items-center rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black disabled:opacity-40"
              >
                {isNew ? "Create agent" : "Save"}
              </button>
              {draft.builtIn && overridden ? (
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-9 items-center rounded-md border border-[#d1d7e0] bg-white px-4 text-[13px] font-medium text-mm-dark hover:bg-[#f7f9fc]"
                >
                  Reset to built-in
                </button>
              ) : null}
              {!draft.builtIn && !isNew ? (
                <button
                  type="button"
                  onClick={remove}
                  className="ml-auto inline-flex h-9 items-center px-2 text-[13px] font-medium text-[#c4242a] hover:underline"
                >
                  Delete
                </button>
              ) : null}
              {error ? <span className="text-[13px] text-[#c4242a]">{error}</span> : null}
            </div>
          </section>
        ) : (
          <section className={cn(card, "p-5 text-[13px] text-muted-foreground")}>Loading…</section>
        )}
      </div>
    </div>
  )
}

function PresetRow({
  preset,
  active,
  edited,
  onPick,
}: {
  preset: AgentPreset
  active: boolean
  edited?: boolean
  onPick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "block w-full px-4 py-2.5 text-left hover:bg-[#f7f9fc]",
          active && "bg-[#eef1f5]",
        )}
      >
        <span className="block text-[13.5px] font-medium text-mm-dark">
          {preset.label}
          {edited ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">edited</span> : null}
        </span>
      </button>
    </li>
  )
}
