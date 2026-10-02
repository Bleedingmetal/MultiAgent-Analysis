"use client"

import {
  useMemo,
  useState,
} from "react"

import {
  architectures,
  benchmarks,
  comparisonRows,
  formatLatency,
  formatPct,
  formatUsd,
  getArchitecture,
} from "@/data/evaluation-mock"

type MetricKey = "success" | "costPerSuccess" | "latencySec"

const metricMeta: Record<
  MetricKey,
  { label: string; higherIsBetter: boolean }
> = {
  success: {
    label: "Success",
    higherIsBetter: true,
  },
  costPerSuccess: {
    label: "Cost / success",
    higherIsBetter: false,
  },
  latencySec: {
    label: "Latency",
    higherIsBetter: false,
  },
}

function formatMetric(key: MetricKey, value: number) {
  if (key === "success") return formatPct(value)
  if (key === "costPerSuccess") return formatUsd(value)
  return formatLatency(value)
}

export default function Compare() {
  const [benchmarkId, setBenchmarkId] = useState(benchmarks[0].id)
  const [metric, setMetric] = useState<MetricKey>("success")

  const rows = useMemo(
    () => comparisonRows.filter((row) => row.benchmarkId === benchmarkId),
    [benchmarkId],
  )

  const benchmark = benchmarks.find((b) => b.id === benchmarkId)!
  const meta = metricMeta[metric]

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      if (meta.higherIsBetter) return b[metric] - a[metric]
      return a[metric] - b[metric]
    })
    const values = sorted.map((r) => r[metric])
    const min = Math.min(...values)
    const max = Math.max(...values)
    return sorted.map((row) => {
      const span = max - min || 1
      const normalized = meta.higherIsBetter
        ? (row[metric] - min) / span
        : (max - row[metric]) / span
      return { row, bar: Math.max(normalized, 0.08) }
    })
  }, [rows, metric, meta.higherIsBetter])

  const winner = ranked[0]?.row
  const winnerArch = winner
    ? getArchitecture(winner.architectureId)
    : undefined

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-mm-dark">
          Compare
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rank architectures for a benchmark on success, cost, or latency.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:flex-row md:items-end md:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Benchmark
            </span>
            <select
              value={benchmarkId}
              onChange={(e) => setBenchmarkId(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"
            >
              {benchmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Metric
            </span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"
            >
              {(Object.keys(metricMeta) as MetricKey[]).map((key) => (
                <option key={key} value={key}>
                  {metricMeta[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-lg bg-mm-dark px-4 py-3 text-white md:min-w-[200px]">
          <p className="text-sm text-white/60">
            Best {meta.label.toLowerCase()}
          </p>
          <p className="mt-1 text-lg font-semibold">
            {winnerArch?.label ?? "-"}
          </p>
          <p className="mt-0.5 text-xs text-white/60">{benchmark.structure}</p>
        </div>
      </div>

      <div className="grid gap-3">
        {ranked.map(({ row, bar }, index) => {
          const arch = getArchitecture(row.architectureId)!
          const isWinner = index === 0

          return (
            <div
              key={`${row.benchmarkId}-${row.architectureId}`}
              className={`rounded-xl border bg-card p-4 ${
                isWinner ? "border-mm-charge/40" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-mm-dark">
                      {arch.label}
                    </h2>
                    {isWinner && (
                      <span className="rounded-full bg-mm-charge/10 px-2 py-0.5 text-[10px] font-semibold text-mm-charge">
                        Best
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {arch.summary}
                  </p>
                </div>
                <p className="text-2xl font-semibold tabular-nums text-mm-dark">
                  {formatMetric(metric, row[metric])}
                </p>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-mm-charge"
                  style={{ width: `${bar * 100}%` }}
                />
              </div>

              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Success</p>
                  <p className="font-medium tabular-nums">
                    {formatPct(row.success)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cost / success</p>
                  <p className="font-medium tabular-nums">
                    {formatUsd(row.costPerSuccess)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Latency</p>
                  <p className="font-medium tabular-nums">
                    {formatLatency(row.latencySec)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Mock data for UI. {architectures.length} architectures available.
      </p>
    </div>
  )
}
