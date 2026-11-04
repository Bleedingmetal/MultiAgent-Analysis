"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowSquareOut, ClockCounterClockwise, Play } from "@phosphor-icons/react"

import {
  type BatchRun,
  type RunMode,
  cancelBatch,
  createBatch,
  getBatch,
  listBatches,
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
const POLL_MS = 1500

export function BatchRunPanel({
  configuration,
  runMode,
  datasetTotal,
  remainingBudget,
  canRun,
  onSpendChanged,
}: {
  configuration: AgentConfiguration
  runMode: RunMode
  datasetTotal: number
  remainingBudget: number | null
  canRun: boolean
  onSpendChanged: () => void
}) {
  const [size, setSize] = useState<number | null>(25)
  const [budget, setBudget] = useState("1.00")
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
        benchmark_id: "finqa",
        size,
        budget_usd: budgetValue,
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
      {/* Setup */}
      <div className="rounded-2xl border border-border/70 bg-[#fafbfd] p-4">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              FinQA questions
            </p>
            <div className="seg-track flex-wrap">
              {SIZE_OPTIONS.map((option) => (
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
                All {datasetTotal ? datasetTotal.toLocaleString() : ""}
              </button>
            </div>
          </div>
          <label className="block">
            <span className="mb-2 block text-[12px] font-medium text-muted-foreground">
              Spend cap
            </span>
            <span className="flex h-9 items-center rounded-full border border-border/80 bg-white px-3 font-data text-[13px]">
              $
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                className="ml-1 w-16 bg-transparent outline-none"
                aria-label="Spend cap in dollars"
                disabled={running}
              />
            </span>
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canRun || running || starting || !budgetOk}
            className="island-cta ml-auto disabled:pointer-events-none disabled:opacity-50"
          >
            <span>{starting ? "Starting…" : "Run end-to-end"}</span>
            <span className="island-cta-icon" aria-hidden>
              <Play className="size-3.5" weight="fill" />
            </span>
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Every configuration gets the same {n.toLocaleString()} questions in the same order,
          so pass rates are directly comparable.
          {remainingBudget != null ? ` ${usd(remainingBudget)} left in today's budget.` : ""}
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl border border-mm-orange/25 bg-mm-orange/8 px-4 py-3 text-sm text-[#b34800]">
          {error}
        </p>
      ) : null}

      {batch ? (
        <>
          <BatchResults batch={batch} onStop={() => void stop()} />
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
                  <span className="text-mm-dark">{pct(row.summary.pass_rate, 1)}</span>
                  <span className="text-muted-foreground">
                    {row.summary.done}/{row.size} · {usd(row.summary.cost_usd)}
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
