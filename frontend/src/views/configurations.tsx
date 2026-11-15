"use client"

/*
 * Configurations, in the app's "Achromatic ledger" style (same sheet as the Overview):
 * ink chrome, white panels on the blue-grey ground, the one hue only on the data, which
 * here is the models inside each architecture. Every saved configuration is a panel that
 * shows its pipeline as a map (layers left to right, nodes stacked inside), the models in
 * use, and the last end-to-end result, so the list answers "what is this and how did it do"
 * without opening anything.
 */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"

import { pct, usd, when } from "@/components/product/batch-results"
import { type BatchRun, benchmarkName, listBatches } from "@/lib/api"
import { deleteConfiguration, getConfigurations } from "@/lib/configuration-storage"
import { cn } from "@/lib/utils"
import type { AgentConfiguration, ConfigurationNode } from "@/types/configuration"

const ARCH_LABEL: Record<string, string> = {
  "single-agent": "Single agent",
  "prompt-chaining": "Prompt chain",
  routing: "Routing",
  parallelization: "Parallel",
  "evaluator-optimizer": "Evaluator loop",
  "autonomous-agent": "Autonomous agent",
  custom: "Custom",
}

const NODE_KIND: Record<string, string> = {
  input: "Task input",
  output: "Final answer",
  router: "Router",
  "parallel-controller": "Controller",
  evaluator: "Evaluator",
  aggregator: "Aggregator",
  tool: "Tool",
}

const FINISHED = new Set<BatchRun["status"]>(["completed", "stopped", "cancelled", "interrupted"])
const card = "rounded-lg border border-[#e3e8ef] bg-white"

/** The latest finished end-to-end run with results, per configuration. */
function latestResults(batches: BatchRun[]) {
  const out = new Map<string, BatchRun>()
  for (const b of [...batches].sort((a, c) => c.created_at.localeCompare(a.created_at))) {
    if (!FINISHED.has(b.status) || b.summary.passed + b.summary.failed === 0) continue
    if (!out.has(b.configuration_id)) out.set(b.configuration_id, b)
  }
  return out
}

function modelsOf(configuration: AgentConfiguration) {
  const ids = configuration.nodes
    .filter((n) => n.type === "model" && n.modelSettings?.model)
    .map((n) => n.modelSettings!.model)
  return [...new Set(ids)]
}

/** The pipeline as a map: one column per layer, nodes stacked inside, in run order. */
function ArchitectureMap({ configuration }: { configuration: AgentConfiguration }) {
  const layers = [...configuration.layers].sort((a, b) => a.order - b.order)
  const byLayer = new Map<string, ConfigurationNode[]>()
  for (const node of [...configuration.nodes].sort((a, b) => a.order - b.order)) {
    byLayer.set(node.layerId, [...(byLayer.get(node.layerId) ?? []), node])
  }
  const columns = layers.map((l) => byLayer.get(l.id) ?? []).filter((c) => c.length)
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1">
      {columns.map((nodes, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 ? (
            <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden className="shrink-0 text-[#9aa3b5]">
              <path d="M0 5h15M11 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {nodes.map((node) => <NodeChip key={node.id} node={node} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function NodeChip({ node }: { node: ConfigurationNode }) {
  const isModel = node.type === "model"
  const kind = NODE_KIND[node.type] ?? node.type
  // Agents show their model; other nodes show their kind only when the name does not already say it
  const detail = isModel
    ? node.modelSettings?.model ?? "model not set"
    : kind.toLowerCase() === node.name.trim().toLowerCase() ? null : kind
  return (
    <div
      className={cn(
        "min-w-[112px] rounded-md border border-[#e3e8ef] bg-[#fafbfd] px-2.5 py-1.5 leading-tight",
        isModel && "border-l-2 border-l-[#1d5fbf] bg-white",
      )}
      title={isModel ? `${node.name} · ${detail}` : node.name}
    >
      <p className="truncate text-[12px] font-medium text-mm-dark">{node.name}</p>
      {detail ? (
        <p className={cn("mt-0.5 truncate text-[11px] text-muted-foreground", isModel && "font-data")}>{detail}</p>
      ) : null}
    </div>
  )
}

function ConfigurationPanel({
  configuration,
  result,
  onDelete,
}: {
  configuration: AgentConfiguration
  result?: BatchRun
  onDelete: (id: string) => void
}) {
  const models = modelsOf(configuration)
  const agents = configuration.nodes.filter((n) => n.type === "model").length
  return (
    <article className={cn(card, "flex flex-col gap-4 p-5")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold text-mm-dark">
            <Link href={`/configurations/${configuration.id}`} className="hover:underline">
              {configuration.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {ARCH_LABEL[configuration.architecture] ?? configuration.architecture}
            {" · "}
            {agents} {agents === 1 ? "agent" : "agents"}
            {configuration.description ? ` · ${configuration.description}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/configurations/${configuration.id}`}
            className="inline-flex h-8 items-center rounded-md bg-[#1d1f20] px-3 text-[13px] font-medium text-white hover:bg-black"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={() => onDelete(configuration.id)}
            aria-label={`Delete ${configuration.name}`}
            className="inline-flex size-8 items-center justify-center rounded-md border border-[#e3e8ef] text-muted-foreground hover:bg-[#f4f7fb] hover:text-mm-dark"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <ArchitectureMap configuration={configuration} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[#e3e8ef] pt-4 text-[13px] sm:grid-cols-3">
        <div className="min-w-0 sm:col-span-1">
          <dt className="text-muted-foreground">Models</dt>
          <dd className="mt-0.5 truncate font-data text-[12px] text-mm-dark" title={models.join(", ")}>
            {models.length ? models.join(", ") : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Last end-to-end run</dt>
          <dd className="mt-0.5 text-mm-dark">
            {result ? (
              <Link href={`/runs/e2e/${result.id}`} className="hover:underline">
                <span className="font-data">{pct(result.summary.pass_rate, 0)}</span> on {benchmarkName(result.benchmark_id)}
                {result.summary.cost_per_pass_usd != null ? (
                  <span className="text-muted-foreground"> · {usd(result.summary.cost_per_pass_usd)} per correct</span>
                ) : null}
              </Link>
            ) : (
              <span className="text-muted-foreground">Not run yet</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{result ? "Ran" : "Edited"}</dt>
          <dd className="mt-0.5 text-mm-dark">{when(result ? result.created_at : configuration.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  )
}

export default function Configurations() {
  const [configurations, setConfigurations] = useState<AgentConfiguration[]>([])
  const [batches, setBatches] = useState<BatchRun[]>([])

  useEffect(() => {
    setConfigurations(getConfigurations())
    listBatches(undefined, 200)
      .then((res) => setBatches(res.batches))
      .catch(() => undefined)
  }, [])

  const results = useMemo(() => latestResults(batches), [batches])

  function handleDelete(id: string) {
    const configuration = configurations.find((item) => item.id === id)
    if (!configuration) return
    if (!window.confirm(`Delete "${configuration.name}"?`)) return
    deleteConfiguration(id)
    setConfigurations(getConfigurations())
  }

  const withResults = configurations.filter((c) => results.has(c.id)).length

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rise-in">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Configurations</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {configurations.length} saved
            {configurations.length ? ` · ${withResults} with end-to-end results` : ""}
          </p>
        </div>
        <Link
          href="/configurations/new"
          className="inline-flex h-9 items-center rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black"
        >
          New configuration
        </Link>
      </div>

      {configurations.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {configurations.map((configuration) => (
            <ConfigurationPanel
              key={configuration.id}
              configuration={configuration}
              result={results.get(configuration.id)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className={cn(card, "px-6 py-14 text-center")}>
          <p className="text-[15px] font-medium text-mm-dark">No configurations yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Start from a template: single agent, prompt chain, routing, parallel, evaluator loop.
          </p>
          <Link
            href="/configurations/new"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black"
          >
            New configuration
          </Link>
        </div>
      )}
    </div>
  )
}
