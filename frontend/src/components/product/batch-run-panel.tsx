"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowSquareOut, ClockCounterClockwise, Play } from "@phosphor-icons/react"

import {
  type BatchRun,
  type BenchmarkId,
  type BenchmarkInfo,
  type RunMode,
  benchmarkName,
  cancelBatch,
  continueBatch,
  createBatch,
  getBatch,
  getHealth,
  listBatches,
  taskNoun,
  primaryAccuracy,
} from "@/lib/api"
import type { AgentConfiguration } from "@/types/configuration"
import {
  BATCH_STATUS_LABEL,
  BatchResults,
  pct,
  usd,
  when,
} from "@/components/product/batch-results"
import { cn } from "@/lib/utils"

const SIZE_OPTIONS = [10, 25, 50, 100, 250] as const
// One pass is not representative; up to ten passes per question
const PASS_OPTIONS = [1, 2, 3, 5, 10] as const
const POLL_MS = 1500

export function BatchRunPanel({
  configuration,
  runMode,
  benchmarks,
  remainingBudget,
  canRun,
  onSpendChanged,
}: {
  configuration: AgentConfiguration
  runMode: RunMode
  // Scored benchmarks the backend has data for
  benchmarks: BenchmarkInfo[]
  remainingBudget: number | null
  canRun: boolean
  onSpendChanged: () => void
}) {
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>("finqa")
  const [size, setSize] = useState<number | null>(25)
  const [passes, setPasses] = useState<number>(1)
  const benchmark = benchmarks.find((b) => b.id === benchmarkId) ?? benchmarks[0]
  const datasetTotal = benchmark?.task_count ?? 0
  const activeBenchmarkId = benchmark?.id ?? benchmarkId
  const sizeOptions = SIZE_OPTIONS.filter((o) => o < datasetTotal)
  // The default cap comes from RUN_BUDGET_USD in backend/.env; typing in the box overrides it.
  const [budget, setBudget] = useState("1.00")
  const [budgetTouched, setBudgetTouched] = useState(false)
  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((h) => {
        const cap = h.spend?.run_budget_usd
        if (!cancelled && !budgetTouched && cap != null && cap > 0) setBudget(cap.toFixed(2))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [history, setHistory] = useState<BatchRun[]>([])
  const [batch, setBatch] = useState<BatchRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshHistory = useCallback(async () => {
    const res = await listBatches(configuration.id)
    setHistory(res.batches)
    return res.batches
  }, [configuration.id])

  // Load history, and resume (or show) the latest end-to-end run for this config.
  useEffect(() => {
    let cancelled = false
    refreshHistory()
      .then(async (rows) => {
        if (cancelled || !rows.length) return
        const latest = await getBatch(rows[0].id)
        if (!cancelled) setBatch(latest)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshHistory])

  const running = batch?.status === "running"
  const batchId = batch?.id

  // Poll while running.
  useEffect(() => {
    if (!running || !batchId) return
    const timer = setInterval(async () => {
      try {
        const next = await getBatch(batchId)
        setBatch(next)
        if (next.status !== "running") {
          onSpendChanged()
          refreshHistory().catch(() => undefined)
        }
      } catch {
        /* keep polling */
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, batchId, onSpendChanged, refreshHistory])

  const n = size ?? datasetTotal
  // Cost guess from the most recent run of this configuration, when there is one
  const estimate =
    batch?.summary.avg_cost_usd != null && batch.benchmark_id === activeBenchmarkId
      ? batch.summary.avg_cost_usd * n * passes
      : null
  const budgetValue = Number(budget)
  const budgetOk = Number.isFinite(budgetValue) && budgetValue > 0

  async function start() {
    if (!budgetOk) return
    setStarting(true)
    setError(null)
    try {
      const created = await createBatch({
        configuration,
        mode: runMode,
        benchmark_id: activeBenchmarkId,
        size,
        budget_usd: budgetValue,
        passes,
      })
      setBatch(created)
      refreshHistory().catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the run")
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    if (!batch) return
    try {
      setBatch(await cancelBatch(batch.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel")
    }
  }

  async function keepGoing() {
    if (!batch) return
    setError(null)
    try {
      setBatch(await continueBatch(batch.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue")
    }
  }

  async function openBatch(id: string) {
    setError(null)
    try {
      setBatch(await getBatch(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that run")
    }
  }

  return (
    <div className="space-y-6 p-5">
      {/* Setup: one row of controls, one sentence that states what will run */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-white">
        <div className="flex flex-wrap items-end gap-x-7 gap-y-4 p-5">
          {benchmarks.length > 1 ? (
            <div>
              <p className="mb-2 text-[12px] font-medium text-muted-foreground">Benchmark</p>
              <div className="seg-track whitespace-nowrap">
                {benchmarks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="seg-item"
                    data-active={activeBenchmarkId === b.id}
                    onClick={() => {
                      setBenchmarkId(b.id)
                      setSize((s) => (s != null && s >= b.task_count ? null : s))
                    }}
                    disabled={running}
                  >
                    {benchmarkName(b.id)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              {taskNoun(activeBenchmarkId, 2).replace(/^./, (c) => c.toUpperCase())}
            </p>
            <div className="seg-track whitespace-nowrap">
              {sizeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="seg-item"
                  data-active={size === option}
                  onClick={() => setSize(option)}
                  disabled={running}
                >
                  {option}
                </button>
              ))}
              <button
                type="button"
                className="seg-item"
                data-active={size === null}
                onClick={() => setSize(null)}
                disabled={running}
              >
                All
              </button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">Full passes</p>
            <div className="seg-track whitespace-nowrap">
              {PASS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="seg-item"
                  data-active={passes === option}
                  onClick={() => setPasses(option)}
                  disabled={running}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-2 block text-[12px] font-medium text-muted-foreground">Spend cap</span>
            <span className="flex h-9 items-center rounded-full border border-border/80 bg-white px-3.5 font-data text-[13px]">
              $
              <input
                value={budget}
                onChange={(e) => { setBudgetTouched(true); setBudget(e.target.value) }}
                inputMode="decimal"
                className="ml-1 w-14 bg-transparent outline-none"
                aria-label="Spend cap in dollars"
                disabled={running}
              />
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-border/70 bg-[#fafbfd] px-5 py-3">
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-mm-dark">
            {n.toLocaleString()} {benchmarkName(activeBenchmarkId)} {taskNoun(activeBenchmarkId, n)}
            {passes > 1 ? ` × ${passes} full passes = ${(n * passes).toLocaleString()} results` : ""}
          </span>
          {estimate != null ? <> · about <span className="font-data text-mm-dark">{usd(estimate)}</span> at the last run&apos;s cost per answer</> : null}
          {remainingBudget != null ? <> · <span className="font-data text-mm-dark">{usd(remainingBudget)}</span> left today</> : null}
          .{" "}
          {passes > 1
            ? "The whole set runs once, then runs again: the pass rate is averaged over the passes and you see which questions flip."
            : `Every configuration gets the same ${taskNoun(activeBenchmarkId, 2)} in the same order. Add passes to see how stable the results are.`}
        </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canRun || running || starting || !budgetOk}
            className="island-cta shrink-0 disabled:pointer-events-none disabled:opacity-50"
          >
            <span>{starting ? "Starting…" : running ? "Running…" : "Run end-to-end"}</span>
            <span className="island-cta-icon" aria-hidden>
              <Play className="size-3.5" weight="fill" />
            </span>
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-2xl border border-mm-orange/25 bg-mm-orange/8 px-4 py-3 text-sm text-[#b34800]">
          {error}
        </p>
      ) : null}

      {batch ? (
        <>
          <BatchResults batch={batch} onStop={() => void stop()} onContinue={() => void keepGoing()} />
          <Link
            href={`/runs/e2e/${batch.id}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-charge hover:underline"
          >
            Open run page <ArrowSquareOut className="size-3.5" weight="bold" />
          </Link>
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No end-to-end runs for this configuration yet.
        </p>
      )}

      {/* History */}
      {history.length > 1 || (history.length === 1 && history[0].id !== batch?.id) ? (
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
            <ClockCounterClockwise className="size-3.5" weight="bold" />
            Previous end-to-end runs
          </p>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-white">
            {history.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => void openBatch(row.id)}
                  className={cn(
                    "flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left font-data text-[12px] transition-colors hover:bg-[#f4f7fb]",
                    row.id === batch?.id && "bg-[#f4f7fb]",
                  )}
                >
                  <span className="text-mm-blue">{row.id}</span>
                  <span className="text-muted-foreground">{when(row.created_at)}</span>
                  <span className="text-mm-dark">{pct(primaryAccuracy(row.summary), 1)}</span>
                  <span className="text-muted-foreground">
                    {row.summary.done}/{row.size}
                    {(row.passes ?? 1) > 1 ? ` × ${row.passes}` : ""} · {usd(row.summary.cost_usd)}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {BATCH_STATUS_LABEL[row.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
