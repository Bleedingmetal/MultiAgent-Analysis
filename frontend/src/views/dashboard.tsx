"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"

import {
  Bezel,
  DeltaPill,
  IslandLink,
  MetricTile,
  Reveal,
  RevealInView,
  SectionTitle,
} from "@/components/product/ui-bits"
import { Button } from "@/components/ui/button"
import {
  architectures,
  benchmarks,
  comparisonRows,
  formatLatency,
  formatPct,
  formatUsd,
  getArchitecture,
  getBenchmark,
  recentRuns,
  taskRegimes,
  type ComparisonRow,
} from "@/data/evaluation-mock"

type MetricKey = "success" | "costPerSuccess" | "latencySec"

const matrixArms = architectures.filter(
  (a) => a.id === "single-agent" || a.id === "orchestrator-workers",
)

function heatBackground(
  metric: MetricKey,
  value: number,
  min: number,
  max: number,
) {
  const span = max - min || 1
  const t = (value - min) / span
  const score = metric === "success" ? t : 1 - t
  const alpha = 0.07 + score * 0.38
  return `rgba(2, 101, 255, ${alpha.toFixed(3)})`
}

function formatMetric(metric: MetricKey, value: number) {
  if (metric === "success") return formatPct(value)
  if (metric === "costPerSuccess") return formatUsd(value)
  return formatLatency(value)
}

function onHeatMove(e: React.MouseEvent<HTMLButtonElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`)
  e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`)
}

export default function Dashboard() {
  const reduce = useReducedMotion()
  const [metric, setMetric] = useState<MetricKey>("success")
  const [selected, setSelected] = useState<{
    benchmarkId: string
    architectureId: string
  }>({
    benchmarkId: "fab",
    architectureId: "orchestrator-workers",
  })

  const selectedRow = comparisonRows.find(
    (r) =>
      r.benchmarkId === selected.benchmarkId &&
      r.architectureId === selected.architectureId,
  )!

  const counterpart = comparisonRows.find(
    (r) =>
      r.benchmarkId === selected.benchmarkId &&
      r.architectureId ===
        (selected.architectureId === "single-agent"
          ? "orchestrator-workers"
          : "single-agent"),
  )

  const ranges = useMemo(() => {
    const values = comparisonRows
      .filter((r) => matrixArms.some((a) => a.id === r.architectureId))
      .map((r) => r[metric])
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    }
  }, [metric])

  const kpi = useMemo(() => {
    const focus = comparisonRows.filter((r) =>
      matrixArms.some((a) => a.id === r.architectureId),
    )
    const avg = (key: MetricKey) =>
      focus.reduce((sum, row) => sum + row[key], 0) / focus.length
    return {
      success: avg("success"),
      cost: avg("costPerSuccess"),
      latency: avg("latencySec"),
    }
  }, [])

  const fabLift =
    (comparisonRows.find(
      (r) =>
        r.benchmarkId === "fab" &&
        r.architectureId === "orchestrator-workers",
    )?.success ?? 0) -
    (comparisonRows.find(
      (r) =>
        r.benchmarkId === "fab" && r.architectureId === "single-agent",
    )?.success ?? 0)

  const tauSlow =
    (comparisonRows.find(
      (r) =>
        r.benchmarkId === "tau-retail" &&
        r.architectureId === "orchestrator-workers",
    )?.latencySec ?? 0) /
    (comparisonRows.find(
      (r) =>
        r.benchmarkId === "tau-retail" &&
        r.architectureId === "single-agent",
    )?.latencySec ?? 1)

  function cell(
    benchmarkId: string,
    architectureId: string,
  ): ComparisonRow | undefined {
    return comparisonRows.find(
      (r) =>
        r.benchmarkId === benchmarkId &&
        r.architectureId === architectureId,
    )
  }

  const selectedBench = getBenchmark(selected.benchmarkId)
  const selectedArch = getArchitecture(selected.architectureId)

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10">
      <Reveal className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-mm-dark md:text-[42px]">
            Architecture tradeoffs
          </h2>
          <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-muted-foreground">
            Select a matrix cell to inspect success, cost, and latency for that
            architecture on that benchmark.
          </p>
        </div>
        <IslandLink href="/compare">Open full compare</IslandLink>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-12">
        <Reveal delay={0.06} className="lg:col-span-5">
          <MetricTile
            large
            label="Mean success"
            value={formatPct(kpi.success)}
            hint="Single + orchestrator across three benchmarks"
            className="h-full"
          />
        </Reveal>
        <Reveal delay={0.1} className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <MetricTile
            label="Mean cost / success"
            value={formatUsd(kpi.cost)}
            hint="Lower when budget is the constraint"
          />
          <MetricTile
            label="Mean latency"
            value={formatLatency(kpi.latency)}
            hint="Critical for human-facing tool use"
          />
          <div className="surface flex flex-col justify-between p-5 sm:col-span-2">
            <p className="text-[12px] font-medium text-muted-foreground">
              Signal checks
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-sm text-mm-dark">FAB multi lift</span>
                <DeltaPill value={`+${fabLift.toFixed(1)} pts`} tone="up" />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-sm text-mm-dark">τ-bench multi lag</span>
                <DeltaPill
                  value={`${tauSlow.toFixed(1)}x slower`}
                  tone="down"
                />
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.14} className="grid gap-4 xl:grid-cols-12">
        <Bezel className="xl:col-span-8" coreClassName="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
            <div>
              <h3 className="text-[16px] font-semibold tracking-tight text-mm-dark">
                Architecture × benchmark
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Heat encodes the selected metric
              </p>
            </div>
            <div className="seg-track">
              {(
                [
                  ["success", "Success"],
                  ["costPerSuccess", "Cost"],
                  ["latencySec", "Latency"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-active={metric === key}
                  className="seg-item"
                  onClick={() => setMetric(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto p-5">
            <div
              className="grid min-w-[560px] gap-2.5"
              style={{
                gridTemplateColumns: `150px repeat(${matrixArms.length}, minmax(0, 1fr))`,
              }}
            >
              <div />
              {matrixArms.map((arm) => (
                <div
                  key={arm.id}
                  className="px-2 pb-1 text-center text-[12px] font-medium text-muted-foreground"
                >
                  {arm.label}
                </div>
              ))}

              {benchmarks.map((bench, bi) => (
                <div key={bench.id} className="contents">
                  <div className="flex items-center pr-2">
                    <div>
                      <p className="text-sm font-medium text-mm-dark">
                        {bench.shortName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {bench.structure}
                      </p>
                    </div>
                  </div>
                  {matrixArms.map((arm, ai) => {
                    const row = cell(bench.id, arm.id)
                    if (!row) return <div key={arm.id} />
                    const active =
                      selected.benchmarkId === bench.id &&
                      selected.architectureId === arm.id
                    return (
                      <motion.button
                        key={arm.id}
                        type="button"
                        data-selected={active}
                        className="heat-cell rounded-2xl border border-border/60 px-3.5 py-3.5 text-left"
                        style={{
                          background: heatBackground(
                            metric,
                            row[metric],
                            ranges.min,
                            ranges.max,
                          ),
                        }}
                        initial={
                          reduce
                            ? false
                            : { opacity: 0, scale: 0.96 }
                        }
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          delay: 0.18 + bi * 0.05 + ai * 0.03,
                          duration: 0.45,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        onMouseMove={onHeatMove}
                        onClick={() =>
                          setSelected({
                            benchmarkId: bench.id,
                            architectureId: arm.id,
                          })
                        }
                      >
                        <p className="relative z-[1] font-data text-[20px] font-medium text-mm-dark">
                          {formatMetric(metric, row[metric])}
                        </p>
                        <p className="relative z-[1] mt-1.5 text-[11px] text-mm-dark/60">
                          {metric === "success"
                            ? `${formatUsd(row.costPerSuccess)} · ${formatLatency(row.latencySec)}`
                            : metric === "costPerSuccess"
                              ? `${formatPct(row.success)} · ${formatLatency(row.latencySec)}`
                              : `${formatPct(row.success)} · ${formatUsd(row.costPerSuccess)}`}
                        </p>
                      </motion.button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </Bezel>

        <aside className="xl:col-span-4">
          <Bezel className="h-full xl:sticky xl:top-24" coreClassName="flex h-full flex-col overflow-hidden">
            <div className="border-b border-border/70 px-5 py-4">
              <p className="text-[12px] font-medium text-muted-foreground">
                Selected cell
              </p>
              <h3 className="mt-1.5 text-[17px] font-semibold tracking-tight text-mm-dark">
                {selectedBench?.name}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {selectedArch?.label}
              </p>
            </div>

            <div className="flex flex-1 flex-col gap-4 px-5 py-5">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Success", formatPct(selectedRow.success)],
                    ["Cost", formatUsd(selectedRow.costPerSuccess)],
                    ["Latency", formatLatency(selectedRow.latencySec)],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl bg-muted/70 px-2.5 py-3"
                  >
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-1 font-data text-sm font-medium text-mm-dark">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {counterpart ? (
                <div className="rounded-2xl border border-border/80 bg-[#f7f9fc] p-4">
                  <p className="text-[12px] font-medium text-muted-foreground">
                    Versus{" "}
                    {selected.architectureId === "single-agent"
                      ? "Orchestrator-workers"
                      : "Single agent"}
                  </p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Success</span>
                      <span className="font-data text-mm-dark">
                        {(selectedRow.success - counterpart.success).toFixed(1)}{" "}
                        pts
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-data text-mm-dark">
                        {formatUsd(
                          selectedRow.costPerSuccess -
                            counterpart.costPerSuccess,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Latency</span>
                      <span className="font-data text-mm-dark">
                        {(
                          selectedRow.latencySec - counterpart.latencySec
                        ).toFixed(1)}
                        s
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              <p className="text-sm leading-relaxed text-muted-foreground">
                {selectedRow.note}
              </p>

              <div className="mt-auto pt-2">
                <Button
                  render={
                    <Link
                      href={`/compare?benchmark=${selected.benchmarkId}`}
                    />
                  }
                  variant="outline"
                  className="h-10 w-full rounded-full border-border/80 text-sm"
                >
                  Inspect on Compare
                  <ArrowRight className="size-4" weight="bold" />
                </Button>
              </div>
            </div>
          </Bezel>
        </aside>
      </Reveal>

      <RevealInView>
        <SectionTitle title="Task types" />
        <div className="grid gap-4 lg:grid-cols-3">
          {taskRegimes.map((regime, i) => (
            <motion.div
              key={regime.id}
              className="surface-interactive p-5"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                delay: i * 0.06,
                duration: 0.55,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <p className="text-[15px] font-semibold tracking-tight text-mm-dark">
                {regime.title}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {regime.structure}
              </p>
              <div className="mt-5 space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Priority:{" "}
                  <span className="font-medium text-mm-dark">
                    {regime.priority}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Lean:{" "}
                  <span className="font-medium text-mm-dark">
                    {regime.leanArchitecture === "single-agent"
                      ? "Single agent"
                      : regime.leanArchitecture === "multi-agent"
                        ? "Multi-agent"
                        : "Depends on case"}
                  </span>
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </RevealInView>

      <RevealInView>
        <SectionTitle
          title="Recent runs"
          action={
            <Button
              render={<Link href="/runs" />}
              variant="ghost"
              className="h-8 rounded-full text-sm text-mm-charge"
            >
              All runs
              <ArrowRight className="size-4" weight="bold" />
            </Button>
          }
        />
        <Bezel coreClassName="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-border/70 bg-[#f7f9fc] text-[12px] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Run</th>
                <th className="px-5 py-3 font-medium">Benchmark</th>
                <th className="px-5 py-3 font-medium">Architecture</th>
                <th className="px-5 py-3 font-medium">Success</th>
                <th className="px-5 py-3 font-medium">$/success</th>
                <th className="px-5 py-3 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.slice(0, 5).map((run) => {
                const bench = getBenchmark(run.benchmarkId)
                const arch = getArchitecture(run.architectureId)
                return (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3 font-data text-xs text-mm-blue">
                      {run.id}
                    </td>
                    <td className="px-5 py-3 font-medium">
                      {bench?.shortName}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {arch?.label}
                    </td>
                    <td className="px-5 py-3 font-data">
                      {formatPct(run.success)}
                    </td>
                    <td className="px-5 py-3 font-data">
                      {formatUsd(run.costPerSuccess)}
                    </td>
                    <td className="px-5 py-3 font-data">
                      {formatLatency(run.latencySec)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Bezel>
      </RevealInView>
    </div>
  )
}
