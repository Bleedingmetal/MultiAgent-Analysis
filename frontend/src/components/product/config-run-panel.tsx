"use client"

import { useEffect, useMemo, useState } from "react"
import { CaretDown, MagnifyingGlass, Play, Sparkle } from "@phosphor-icons/react"

import {
  type BenchmarkId,
  type RunMode,
  type RunResult,
  createRun,
  getDatasetTasks,
  getDatasets,
  getHealth,
} from "@/lib/api"
import type { AgentConfiguration } from "@/types/configuration"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SpendInfo = NonNullable<Awaited<ReturnType<typeof getHealth>>["spend"]>

const BENCHMARK_SHORT: Record<BenchmarkId, string> = {
  finqa: "FinQA",
  "tau-retail": "tau-bench",
  fab: "FAB",
}

export function ConfigRunPanel({
  configuration,
}: {
  configuration: AgentConfiguration
}) {
  const [benchmarks, setBenchmarks] = useState<
    { id: BenchmarkId; name: string; task_count: number; scored: boolean }[]
  >([])
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>("finqa")
  const [tasks, setTasks] = useState<
    { id: string; question: string; expected_answer: string | null }[]
  >([])
  const [taskId, setTaskId] = useState<string>("")
  const [query, setQuery] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState<RunMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [openaiOk, setOpenaiOk] = useState<boolean | null>(null)
  const [spend, setSpend] = useState<SpendInfo | null>(null)

  async function refreshHealth() {
    const health = await getHealth()
    setApiOk(true)
    setOpenaiOk(health.openai_configured)
    setSpend(health.spend ?? null)
    return health
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refreshHealth()
        if (cancelled) return
        const ds = await getDatasets()
        if (cancelled) return
        setBenchmarks(
          ds.benchmarks.map((b) => ({
            id: b.id,
            name: b.name,
            task_count: b.task_count,
            scored: b.scored,
          })),
        )
      } catch {
        if (!cancelled) {
          setApiOk(false)
          setOpenaiOk(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setPickerOpen(false)
    setQuery("")
    ;(async () => {
      try {
        const res = await getDatasetTasks(benchmarkId, 30)
        if (cancelled) return
        setTasks(
          res.tasks.map((t) => ({
            id: t.id,
            question: t.question,
            expected_answer: t.expected_answer,
          })),
        )
        setTaskId(res.tasks[0]?.id ?? "")
      } catch {
        if (!cancelled) {
          setTasks([])
          setTaskId("")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [benchmarkId])

  const selected = tasks.find((t) => t.id === taskId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(
      (t) =>
        t.question.toLowerCase().includes(q) ||
        (t.expected_answer ?? "").toLowerCase().includes(q),
    )
  }, [tasks, query])

  async function run(mode: RunMode) {
    const label =
      mode === "single-agent" ? "one single-agent OpenAI call" : "one classifier call"
    const ok = window.confirm(
      `This will make ${label} on gpt-4o-mini.\n\n` +
        `Today: $${spend?.spend_usd.toFixed(4) ?? "0"} / $${spend?.daily_budget_usd ?? 1} · ` +
        `${spend?.run_count ?? 0}/${spend?.max_runs_per_day ?? 25} runs\n\nContinue?`,
    )
    if (!ok) return

    setBusy(mode)
    setError(null)
    try {
      const res = await createRun({
        configuration,
        mode,
        benchmark_id: benchmarkId,
        task_id: taskId || null,
        confirm: true,
      })
      setResult(res)
      try {
        await refreshHealth()
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed")
    } finally {
      setBusy(null)
    }
  }

  const blocked =
    !!busy ||
    !apiOk ||
    !openaiOk ||
    (spend != null &&
      (spend.remaining_runs <= 0 || spend.remaining_budget_usd <= 0))

  return (
    <section className="bezel">
      <div className="bezel-core overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          <h3 className="text-[16px] font-semibold tracking-tight text-mm-dark">
            Run
          </h3>
          <div className="flex flex-wrap items-center gap-3 font-data text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  apiOk ? "bg-mm-green" : "bg-mm-orange",
                )}
              />
              API
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  openaiOk ? "bg-mm-green" : "bg-mm-orange",
                )}
              />
              OpenAI
            </span>
            {spend ? (
              <span>
                ${spend.spend_usd.toFixed(4)} · {spend.run_count}/
                {spend.max_runs_per_day}
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Benchmark
            </p>
            <div className="seg-track w-full sm:w-auto">
              {(
                [
                  ["finqa", "FinQA"],
                  ["tau-retail", "tau-bench"],
                  ["fab", "FAB"],
                ] as const
              ).map(([id, label]) => {
                const meta = benchmarks.find((b) => b.id === id)
                return (
                  <button
                    key={id}
                    type="button"
                    data-active={benchmarkId === id}
                    className="seg-item flex-1 sm:flex-none"
                    onClick={() => setBenchmarkId(id)}
                  >
                    {label}
                    {meta?.scored ? (
                      <span className="ml-1 opacity-50">· scored</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-[12px] font-medium text-muted-foreground">
                Task
              </p>
              <p className="font-data text-[11px] text-muted-foreground">
                {BENCHMARK_SHORT[benchmarkId]} · {tasks.length} loaded
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-2xl border bg-white px-4 py-3.5 text-left transition-colors",
                pickerOpen
                  ? "border-mm-charge/40 ring-2 ring-mm-charge/15"
                  : "border-border/80 hover:border-mm-charge/30",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug text-mm-dark">
                  {selected?.question ?? "Select a task"}
                </p>
                {selected?.expected_answer != null ? (
                  <p className="mt-1.5 font-data text-[12px] text-muted-foreground">
                    Expected {selected.expected_answer}
                  </p>
                ) : null}
              </div>
              <CaretDown
                className={cn(
                  "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
                  pickerOpen && "rotate-180",
                )}
                weight="bold"
              />
            </button>

            {pickerOpen ? (
              <div className="mt-2 overflow-hidden rounded-2xl border border-border/80 bg-white shadow-[0_16px_40px_rgba(0,23,53,0.08)]">
                <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
                  <MagnifyingGlass
                    className="size-4 text-muted-foreground"
                    weight="bold"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter tasks"
                    className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                    autoFocus
                  />
                </div>
                <ul className="max-h-[320px] overflow-y-auto p-1.5">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No matches
                    </li>
                  ) : (
                    filtered.map((task) => {
                      const active = task.id === taskId
                      return (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setTaskId(task.id)
                              setPickerOpen(false)
                              setQuery("")
                            }}
                            className={cn(
                              "w-full rounded-xl px-3 py-3 text-left transition-colors",
                              active
                                ? "bg-mm-charge/8"
                                : "hover:bg-muted/70",
                            )}
                          >
                            <p
                              className={cn(
                                "text-[13.5px] leading-snug",
                                active
                                  ? "font-medium text-mm-dark"
                                  : "text-mm-dark/90",
                              )}
                            >
                              {task.question}
                            </p>
                            {task.expected_answer != null ? (
                              <p className="mt-1 font-data text-[11px] text-muted-foreground">
                                Expected {task.expected_answer}
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Open-ended
                              </p>
                            )}
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={blocked || !taskId}
              onClick={() => run("single-agent")}
              className="island-cta disabled:pointer-events-none disabled:opacity-50"
            >
              <span>
                {busy === "single-agent" ? "Running…" : "Run single-agent"}
              </span>
              <span className="island-cta-icon" aria-hidden>
                <Play className="size-3.5" weight="fill" />
              </span>
            </button>
            <Button
              type="button"
              variant="outline"
              disabled={blocked || !taskId}
              onClick={() => run("classify-plan")}
              className="h-[2.85rem] rounded-full px-4 text-sm"
            >
              <Sparkle className="size-4" weight="fill" />
              {busy === "classify-plan" ? "Classifying…" : "Classify"}
            </Button>
          </div>

          {error ? (
            <p className="rounded-2xl border border-mm-orange/25 bg-mm-orange/8 px-4 py-3 text-sm text-[#b34800]">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="rounded-2xl border border-border/70 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-data text-[11px] tracking-wide text-mm-blue">
                  {result.id}
                </p>
                <p className="font-data text-[12px] text-muted-foreground">
                  {result.latency_sec}s · ${result.cost_usd.toFixed(5)} ·{" "}
                  {result.model}
                </p>
              </div>

              {result.success != null ? (
                <p
                  className={cn(
                    "mt-4 text-[28px] font-semibold tracking-tight",
                    result.success ? "text-[#2f7a1f]" : "text-[#b34800]",
                  )}
                >
                  {result.success ? "Pass" : "Fail"}
                </p>
              ) : (
                <p className="mt-4 text-[28px] font-semibold tracking-tight text-mm-dark">
                  Plan
                </p>
              )}

              <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-mm-dark/90">
                {result.answer}
              </p>

              {result.classifier_plan ? (
                <div className="mt-4 grid gap-1 border-t border-border/70 pt-4 text-sm">
                  <p className="font-medium text-mm-dark">
                    {result.classifier_plan.suggested_layout}
                  </p>
                  <p className="text-muted-foreground">
                    {result.classifier_plan.roles.join(" · ")}
                  </p>
                  <p className="text-muted-foreground">
                    {result.classifier_plan.rationale}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {apiOk === false ? (
            <p className="font-data text-[12px] text-muted-foreground">
              API offline · uvicorn app.main:app --reload --port 8000
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
