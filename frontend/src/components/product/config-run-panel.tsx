"use client"

import { useEffect, useState } from "react"
import { Play, Sparkle } from "@phosphor-icons/react"

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

type SpendInfo = NonNullable<Awaited<ReturnType<typeof getHealth>>["spend"]>

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
        const health = await refreshHealth()
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
        void health
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
    ;(async () => {
      try {
        const res = await getDatasetTasks(benchmarkId, 15)
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

  const selected = tasks.find((t) => t.id === taskId)
  const blocked =
    !!busy ||
    !apiOk ||
    !openaiOk ||
    (spend != null &&
      (spend.remaining_runs <= 0 || spend.remaining_budget_usd <= 0))

  return (
    <section className="bezel">
      <div className="bezel-core space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold tracking-tight text-mm-dark">
              Run evaluation
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              One OpenAI call per click. Caps: $
              {spend?.daily_budget_usd ?? 1}/day,{" "}
              {spend?.max_runs_per_day ?? 25} runs/day,{" "}
              {spend?.min_seconds_between_runs ?? 8}s cooldown.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                apiOk
                  ? "bg-mm-green/12 text-[#2f7a1f]"
                  : apiOk === false
                    ? "bg-mm-orange/12 text-[#b34800]"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              API {apiOk == null ? "…" : apiOk ? "up" : "down"}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                openaiOk
                  ? "bg-mm-green/12 text-[#2f7a1f]"
                  : openaiOk === false
                    ? "bg-mm-orange/12 text-[#b34800]"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              OpenAI {openaiOk == null ? "…" : openaiOk ? "ready" : "missing key"}
            </span>
            {spend ? (
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                ${spend.spend_usd.toFixed(4)} / ${spend.daily_budget_usd} ·{" "}
                {spend.run_count}/{spend.max_runs_per_day} runs
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Benchmark
            </span>
            <select
              value={benchmarkId}
              onChange={(e) => setBenchmarkId(e.target.value as BenchmarkId)}
              className="h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
            >
              {benchmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.task_count}
                  {b.scored ? ", scored" : ""})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Task
            </span>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.question.slice(0, 80)}
                  {t.question.length > 80 ? "…" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected ? (
          <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            {selected.question}
            {selected.expected_answer != null ? (
              <span className="mt-1 block font-data text-[12px] text-mm-dark">
                Expected: {selected.expected_answer}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={blocked}
            onClick={() => run("single-agent")}
            className="h-10 rounded-full bg-mm-charge px-4 text-sm"
          >
            <Play className="size-4" weight="fill" />
            {busy === "single-agent" ? "Running…" : "Run single-agent"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={blocked}
            onClick={() => run("classify-plan")}
            className="h-10 rounded-full px-4 text-sm"
          >
            <Sparkle className="size-4" weight="fill" />
            {busy === "classify-plan" ? "Classifying…" : "Classify for multi"}
          </Button>
        </div>

        {error ? (
          <p className="rounded-2xl border border-mm-orange/30 bg-mm-orange/8 px-4 py-3 text-sm text-[#b34800]">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="rounded-2xl border border-border/80 bg-[#f7f9fc] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-data text-xs text-mm-blue">{result.id}</p>
              <p className="text-[12px] text-muted-foreground">
                {result.latency_sec}s · ${result.cost_usd.toFixed(5)} ·{" "}
                {result.model}
              </p>
            </div>
            {result.success != null ? (
              <p
                className={`mt-2 text-sm font-medium ${
                  result.success ? "text-[#2f7a1f]" : "text-[#b34800]"
                }`}
              >
                {result.success ? "Success" : "Fail"} vs expected
                {result.expected_answer != null
                  ? ` (${result.expected_answer})`
                  : ""}
              </p>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap text-sm text-mm-dark">
              {result.answer}
            </p>
            {result.classifier_plan ? (
              <div className="mt-3 rounded-xl bg-white p-3 text-sm">
                <p className="font-medium text-mm-dark">
                  Suggested: {result.classifier_plan.suggested_layout}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Roles: {result.classifier_plan.roles.join(", ")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {result.classifier_plan.rationale}
                </p>
              </div>
            ) : null}
            {result.note ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {result.note}
              </p>
            ) : null}
          </div>
        ) : null}

        {apiOk === false ? (
          <p className="text-[13px] text-muted-foreground">
            Start the API:{" "}
            <code className="font-data text-[12px]">
              cd backend && uvicorn app.main:app --reload --port 8000
            </code>
          </p>
        ) : null}
      </div>
    </section>
  )
}
