"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { motion, useReducedMotion } from "motion/react"

import { Bezel, Reveal } from "@/components/product/ui-bits"
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
  success: { label: "Success", higherIsBetter: true },
  costPerSuccess: { label: "Cost / success", higherIsBetter: false },
  latencySec: { label: "Latency", higherIsBetter: false },
}

function formatMetric(key: MetricKey, value: number) {
  if (key === "success") return formatPct(value)
  if (key === "costPerSuccess") return formatUsd(value)
  return formatLatency(value)
}

function barWidth(
  value: number,
  min: number,
  max: number,
  higherIsBetter: boolean,
) {
  const span = max - min || 1
  const normalized = higherIsBetter
    ? (value - min) / span
    : (max - value) / span
  return Math.max(normalized, 0.08)
}

export default function Compare() {
  const reduce = useReducedMotion()
  const searchParams = useSearchParams()
  const initial =
    searchParams.get("benchmark") &&
    benchmarks.some((b) => b.id === searchParams.get("benchmark"))
      ? (searchParams.get("benchmark") as string)
      : benchmarks[0].id

  const [benchmarkId, setBenchmarkId] = useState(initial)
  const [metric, setMetric] = useState<MetricKey>("success")

  const rows = useMemo(
    () => comparisonRows.filter((row) => row.benchmarkId === benchmarkId),
    [benchmarkId],
  )

  const benchmark = benchmarks.find((b) => b.id === benchmarkId)!
  const meta = metricMeta[metric]

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) =>
      meta.higherIsBetter ? b[metric] - a[metric] : a[metric] - b[metric],
    )
    const values = sorted.map((r) => r[metric])
    const min = Math.min(...values)
    const max = Math.max(...values)
    return sorted.map((row) => ({
      row,
      bar: barWidth(row[metric], min, max, meta.higherIsBetter),
    }))
  }, [rows, metric, meta.higherIsBetter])

  const winner = ranked[0]?.row
  const winnerArch = winner
    ? getArchitecture(winner.architectureId)
    : undefined

  const matrixArchitectures = architectures.filter((a) =>
    rows.some((r) => r.architectureId === a.id),
  )

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal>
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
          Rank by what matters
        </h2>
        <p className="mt-2 max-w-[48ch] text-[15px] text-muted-foreground">
          Pick a benchmark and optimization axis. Architectures sort by that
          metric.
        </p>
      </Reveal>

      <Reveal delay={0.06}>
        <Bezel
          coreClassName="grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Benchmark
            </span>
            <select
              value={benchmarkId}
              onChange={(e) => setBenchmarkId(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
            >
              {benchmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Optimize for
            </span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="h-11 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
            >
              {(Object.keys(metricMeta) as MetricKey[]).map((key) => (
                <option key={key} value={key}>
                  {metricMeta[key].label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-2xl bg-mm-dark px-5 py-4 text-white md:min-w-[220px]">
            <p className="text-[11px] text-mm-light/80">
              Best {meta.label.toLowerCase()}
            </p>
            <p className="mt-1.5 text-[17px] font-semibold tracking-tight">
              {winnerArch?.label}
            </p>
            <p className="mt-1 text-[11px] text-white/50">
              {benchmark.structure}
            </p>
          </div>
        </Bezel>
      </Reveal>

      <Reveal delay={0.1}>
        <Bezel coreClassName="overflow-hidden">
          <div className="border-b border-border/70 px-5 py-4">
            <h3 className="text-[16px] font-semibold text-mm-dark">
              Full metric table
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border/70 bg-[#f7f9fc] text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Architecture</th>
                  <th className="px-5 py-3 font-medium">Success</th>
                  <th className="px-5 py-3 font-medium">Cost / success</th>
                  <th className="px-5 py-3 font-medium">Latency</th>
                  <th className="px-5 py-3 font-medium">Family</th>
                </tr>
              </thead>
              <tbody>
                {matrixArchitectures.map((arch) => {
                  const row = rows.find((r) => r.architectureId === arch.id)!
                  const isBest = winner?.architectureId === arch.id
                  return (
                    <tr
                      key={arch.id}
                      className={`border-b border-border/60 last:border-0 ${
                        isBest ? "bg-mm-charge/5" : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-5 py-3.5 font-medium text-mm-dark">
                        {arch.label}
                        {isBest ? (
                          <span className="ml-2 rounded-full bg-mm-charge/10 px-2 py-0.5 text-[11px] font-medium text-mm-charge">
                            Best
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3.5 font-data">
                        {formatPct(row.success)}
                      </td>
                      <td className="px-5 py-3.5 font-data">
                        {formatUsd(row.costPerSuccess)}
                      </td>
                      <td className="px-5 py-3.5 font-data">
                        {formatLatency(row.latencySec)}
                      </td>
                      <td className="px-5 py-3.5 capitalize text-muted-foreground">
                        {arch.family}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Bezel>
      </Reveal>

      <div className="grid gap-3.5">
        {ranked.map(({ row, bar }, index) => {
          const arch = getArchitecture(row.architectureId)!
          const isWinner = index === 0
          return (
            <motion.article
              key={`${row.benchmarkId}-${row.architectureId}`}
              className={`surface-interactive p-5 md:p-6 ${
                isWinner ? "border-mm-charge/35" : ""
              }`}
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.12 + index * 0.05,
                duration: 0.55,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[17px] font-semibold tracking-tight text-mm-dark">
                      {arch.label}
                    </h3>
                    {isWinner ? (
                      <span className="rounded-full bg-mm-charge/10 px-2 py-0.5 text-[11px] font-medium text-mm-charge">
                        Best on axis
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                    {arch.summary}
                  </p>
                </div>
                <p className="font-data text-[32px] font-medium tracking-tight text-mm-dark">
                  {formatMetric(metric, row[metric])}
                </p>
              </div>

              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-mm-blue to-mm-charge"
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  style={{
                    width: `${bar * 100}%`,
                    transformOrigin: "left center",
                  }}
                  transition={{
                    delay: 0.2 + index * 0.05,
                    duration: 0.7,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                />
              </div>

              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-[12px] text-muted-foreground">Success</p>
                  <p className="font-data font-medium">
                    {formatPct(row.success)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-muted-foreground">
                    Cost / success
                  </p>
                  <p className="font-data font-medium">
                    {formatUsd(row.costPerSuccess)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-muted-foreground">Latency</p>
                  <p className="font-data font-medium">
                    {formatLatency(row.latencySec)}
                  </p>
                </div>
              </div>
            </motion.article>
          )
        })}
      </div>
    </div>
  )
}
