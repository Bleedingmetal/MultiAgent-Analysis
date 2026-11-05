"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { LayoutGroup, motion, useReducedMotion } from "motion/react"

import { BATCH_STATUS_LABEL, pct, secs } from "@/components/product/batch-results"
import { Bezel, Reveal } from "@/components/product/ui-bits"
import { type BatchRun, listBatches, listRuns, type RunResult } from "@/lib/api"
import { cn } from "@/lib/utils"

type Row =
  | { kind: "run"; at: string; run: RunResult }
  | { kind: "batch"; at: string; batch: BatchRun }

type Filter = "all" | "run" | "batch"

const POLL_MS = 2500

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

function successLabel(run: RunResult) {
  if (run.success == null) return "—"
  return run.success ? "Pass" : "Fail"
}

const cell = "px-5 py-3.5"

export default function Runs() {
  const [runs, setRuns] = useState<RunResult[]>([])
  const [batches, setBatches] = useState<BatchRun[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reduce = useReducedMotion()

  async function load() {
    const [res, batchRes] = await Promise.all([listRuns(100), listBatches(undefined, 50)])
    setRuns(res.runs)
    setBatches(batchRes.batches)
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load runs"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Keep a running end-to-end run's row moving
  const anyRunning = batches.some((b) => b.status === "running")
  useEffect(() => {
    if (!anyRunning) return
    const timer = setInterval(() => load().catch(() => undefined), POLL_MS)
    return () => clearInterval(timer)
  }, [anyRunning])

  // End-to-end runs show as one row each; their questions live on the run page.
  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...runs.map((run) => ({ kind: "run" as const, at: run.created_at, run })),
      ...batches.map((batch) => ({ kind: "batch" as const, at: batch.created_at, batch })),
    ]
    return all
      .filter((r) => filter === "all" || r.kind === filter)
      .sort((a, b) => b.at.localeCompare(a.at))
  }, [runs, batches, filter])

  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.32, delay: Math.min(i, 14) * 0.03, ease: [0.22, 1, 0.36, 1] as const },
        }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal>
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
          Runs
        </h2>
        <LayoutGroup id="runs-filter">
          <div className="seg-track mt-5">
            {(
              [
                ["all", "All", runs.length + batches.length],
                ["run", "Single runs", runs.length],
                ["batch", "End-to-end", batches.length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                className="seg-item relative"
                data-active={filter === id}
                onClick={() => setFilter(id)}
              >
                {filter === id ? (
                  <motion.span
                    layoutId="runs-thumb"
                    className="seg-thumb"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }}
                    aria-hidden
                  />
                ) : null}
                <span className="relative z-[1]">
                  {label}
                  <span className="ml-1 opacity-50">{count}</span>
                </span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      </Reveal>

      <Reveal delay={0.06}>
        <Bezel coreClassName="overflow-x-auto">
          {loading ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="px-5 py-8 text-sm text-[#b34800]">{error}</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-10">
              <p className="text-sm text-mm-dark">No runs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Execute from a configuration detail page.
              </p>
              <Link
                href="/configurations"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-mm-charge"
              >
                Configurations
                <ArrowRight className="size-3.5" weight="bold" />
              </Link>
            </div>
          ) : (
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-border/70 bg-[#f7f9fc] text-[12px] text-muted-foreground">
                <tr>
                  <th className={cn(cell, "font-medium")}>Run</th>
                  <th className={cn(cell, "font-medium")}>When</th>
                  <th className={cn(cell, "font-medium")}>Config</th>
                  <th className={cn(cell, "font-medium")}>Benchmark</th>
                  <th className={cn(cell, "font-medium")}>Model</th>
                  <th className={cn(cell, "font-medium")}>Result</th>
                  <th className={cn(cell, "text-right font-medium")}>Cost</th>
                  <th className={cn(cell, "text-right font-medium")}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) =>
                  row.kind === "batch" ? (
                    <BatchRow key={`${filter}-${row.batch.id}`} batch={row.batch} motionProps={enter(i)} />
                  ) : (
                    <motion.tr
                      key={`${filter}-${row.run.id}`}
                      {...enter(i)}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/35"
                    >
                      <td className={cell}>
                        <Link
                          href={`/runs/${row.run.id}`}
                          className="font-data text-xs font-medium text-mm-blue hover:underline"
                        >
                          {row.run.id}
                        </Link>
                      </td>
                      <td className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
                        {formatWhen(row.run.created_at)}
                      </td>
                      <td className={cn(cell, "font-medium text-mm-dark")}>{row.run.configuration_name}</td>
                      <td className={cn(cell, "text-muted-foreground")}>{row.run.benchmark_id}</td>
                      <td className={cn(cell, "font-data text-xs text-muted-foreground")}>{row.run.model}</td>
                      <td className={cell}>
                        <motion.span
                          initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30, delay: Math.min(i, 14) * 0.03 + 0.12 }}
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                            row.run.success === true
                              ? "bg-mm-green/12 text-[#2f7a1f]"
                              : row.run.success === false
                                ? "bg-mm-orange/12 text-[#b34800]"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {successLabel(row.run)}
                        </motion.span>
                      </td>
                      <td className={cn(cell, "text-right font-data")}>${row.run.cost_usd.toFixed(5)}</td>
                      <td className={cn(cell, "text-right font-data")}>{row.run.latency_sec}s</td>
                    </motion.tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </Bezel>
      </Reveal>
    </div>
  )
}

function BatchRow({
  batch,
  motionProps,
}: {
  batch: BatchRun
  motionProps: React.ComponentProps<typeof motion.tr>
}) {
  const s = batch.summary
  const running = batch.status === "running"
  const progress = s.total ? s.done / s.total : 0
  return (
    <motion.tr
      {...motionProps}
      className="relative border-b border-border/60 bg-mm-charge/[0.025] last:border-0 hover:bg-muted/35"
    >
      <td className={cell}>
        <Link
          href={`/runs/e2e/${batch.id}`}
          className="font-data text-xs font-medium text-mm-blue hover:underline"
        >
          {batch.id}
        </Link>
        <span className="ml-2 inline-flex rounded-full bg-mm-charge/10 px-2 py-0.5 text-[10.5px] font-semibold text-mm-charge">
          End-to-end
        </span>
      </td>
      <td className={cn(cell, "whitespace-nowrap text-muted-foreground")}>{formatWhen(batch.created_at)}</td>
      <td className={cn(cell, "font-medium text-mm-dark")}>{batch.configuration_name}</td>
      <td className={cn(cell, "text-muted-foreground")}>
        {batch.benchmark_id} · {batch.size}
        {(batch.passes ?? 1) > 1 ? ` × ${batch.passes}` : ""}
      </td>
      <td className={cn(cell, "font-data text-xs text-muted-foreground")}>{batch.models.join(", ")}</td>
      <td className={cell}>
        {running ? (
          <span className="inline-flex items-center gap-2 text-[11px] font-medium text-mm-charge">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-mm-charge/15">
              <motion.span
                className="block h-full rounded-full bg-mm-charge"
                animate={{ width: `${Math.max(4, progress * 100)}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 24 }}
              />
            </span>
            {s.done}/{s.total}
          </span>
        ) : (
          <span
            className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-mm-dark"
            title={BATCH_STATUS_LABEL[batch.status]}
          >
            {pct(s.pass_rate, 0)} · {s.passed}/{s.passed + s.failed}
          </span>
        )}
      </td>
      <td className={cn(cell, "text-right font-data")}>${s.cost_usd.toFixed(5)}</td>
      <td className={cn(cell, "text-right font-data")}>{secs(s.elapsed_sec)}</td>
    </motion.tr>
  )
}
