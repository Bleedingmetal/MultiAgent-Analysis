"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { motion, useReducedMotion } from "motion/react"

import {
  benchmarks,
  comparisonRows,
  formatLatency,
  formatPct,
  formatUsd,
  getArchitecture,
} from "@/data/evaluation-mock"
import { cn } from "@/lib/utils"

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
  return Math.max(normalized, 0.12)
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

  const meta = metricMeta[metric]

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) =>
      meta.higherIsBetter ? b[metric] - a[metric] : a[metric] - b[metric],
    )
    const values = sorted.map((r) => r[metric])
    const min = Math.min(...values)
    const max = Math.max(...values)
    return sorted.map((row, index) => ({
      row,
      rank: index + 1,
      arch: getArchitecture(row.architectureId)!,
      bar: barWidth(row[metric], min, max, meta.higherIsBetter),
    }))
  }, [rows, metric, meta.higherIsBetter])

  const winner = ranked[0]

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-tight text-mm-dark">
              Compare
            </h2>
            {winner ? (
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Best {meta.label.toLowerCase()}:{" "}
                <span className="font-medium text-mm-dark">
                  {winner.arch.label}
                </span>{" "}
                · {formatMetric(metric, winner.row[metric])}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="block">
              <span className="sr-only">Benchmark</span>
              <select
                value={benchmarkId}
                onChange={(e) => setBenchmarkId(e.target.value)}
                className="h-9 rounded-lg border border-input bg-[#f7f9fc] px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
              >
                {benchmarks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Optimize for</span>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as MetricKey)}
                className="h-9 rounded-lg border border-input bg-[#f7f9fc] px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
              >
                {(Object.keys(metricMeta) as MetricKey[]).map((key) => (
                  <option key={key} value={key}>
                    {metricMeta[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[28%]" />
            <col className="w-[15%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/70 text-[12px] text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Architecture</th>
              <th
                className={cn(
                  "px-4 py-2.5 text-right font-medium",
                  metric === "success" && "text-mm-blue",
                )}
              >
                Success
              </th>
              <th
                className={cn(
                  "px-4 py-2.5 text-right font-medium",
                  metric === "costPerSuccess" && "text-mm-blue",
                )}
              >
                Cost / success
              </th>
              <th
                className={cn(
                  "px-4 py-2.5 text-right font-medium",
                  metric === "latencySec" && "text-mm-blue",
                )}
              >
                Latency
              </th>
              <th className="px-4 py-2.5 font-medium">Rank bar</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ row, rank, arch, bar }, index) => {
              const isBest = rank === 1
              return (
                <motion.tr
                  key={`${row.benchmarkId}-${row.architectureId}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: index * 0.03,
                    duration: 0.3,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className={cn(
                    "border-b border-border/60 last:border-0",
                    isBest ? "bg-mm-charge/[0.04]" : "hover:bg-[#f7f9fc]",
                  )}
                >
                  <td className="px-4 py-3 font-data text-[13px] text-muted-foreground">
                    {rank}
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate font-medium text-mm-dark">
                      {arch.label}
                    </p>
                    <p className="truncate text-[12px] capitalize text-muted-foreground">
                      {arch.family}
                    </p>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-data",
                      metric === "success" && "font-medium text-mm-dark",
                    )}
                  >
                    {formatPct(row.success)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-data",
                      metric === "costPerSuccess" && "font-medium text-mm-dark",
                    )}
                  >
                    {formatUsd(row.costPerSuccess)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-data",
                      metric === "latencySec" && "font-medium text-mm-dark",
                    )}
                  >
                    {formatLatency(row.latencySec)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <motion.div
                        className="h-full rounded-full bg-mm-charge"
                        initial={reduce ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        style={{
                          width: `${bar * 100}%`,
                          transformOrigin: "left center",
                        }}
                        transition={{
                          delay: 0.05 + index * 0.03,
                          duration: 0.45,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                      />
                    </div>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>

        {ranked.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No rows for this benchmark.
          </p>
        ) : null}
      </div>
    </div>
  )
}
