import Link from "next/link"

import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  comparisonRows,
  formatLatency,
  formatPct,
  formatUsd,
  frameworkGates,
  getArchitecture,
  getBenchmark,
  recentRuns,
  taskRegimes,
} from "@/data/evaluation-mock"

function AxisBar({
  label,
  value,
  max,
  invert = false,
  suffix,
}: {
  label: string
  value: number
  max: number
  invert?: boolean
  suffix: string
}) {
  const ratio = Math.min(value / max, 1)
  const width = invert ? 1 - ratio : ratio

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-mm-dark">
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-mm-charge"
          style={{ width: `${Math.max(width * 100, 6)}%` }}
        />
      </div>
    </div>
  )
}

function CompareCard({
  benchmarkLabel,
  structureLabel,
  single,
  multi,
  badge,
  badgeClass,
}: {
  benchmarkLabel: string
  structureLabel: string
  single: (typeof comparisonRows)[number]
  multi: (typeof comparisonRows)[number]
  badge: string
  badgeClass: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-mm-dark">
            {benchmarkLabel}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {structureLabel} · Single agent vs Orchestrator-workers
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${badgeClass}`}
        >
          {badge}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg bg-muted/70 p-4">
          <p className="text-sm font-medium text-mm-dark">Single agent</p>
          <AxisBar
            label="Success"
            value={single.success}
            max={100}
            suffix={formatPct(single.success)}
          />
          <AxisBar
            label="Cost / success"
            value={single.costPerSuccess}
            max={0.1}
            invert
            suffix={formatUsd(single.costPerSuccess)}
          />
          <AxisBar
            label="Latency"
            value={single.latencySec}
            max={30}
            invert
            suffix={formatLatency(single.latencySec)}
          />
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-white p-4">
          <p className="text-sm font-medium text-mm-dark">
            Orchestrator-workers
          </p>
          <AxisBar
            label="Success"
            value={multi.success}
            max={100}
            suffix={formatPct(multi.success)}
          />
          <AxisBar
            label="Cost / success"
            value={multi.costPerSuccess}
            max={0.1}
            invert
            suffix={formatUsd(multi.costPerSuccess)}
          />
          <AxisBar
            label="Latency"
            value={multi.latencySec}
            max={30}
            invert
            suffix={formatLatency(multi.latencySec)}
          />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const fabSingle = comparisonRows.find(
    (r) =>
      r.benchmarkId === "fab" &&
      r.architectureId === "single-agent",
  )!
  const fabMulti = comparisonRows.find(
    (r) =>
      r.benchmarkId === "fab" &&
      r.architectureId === "orchestrator-workers",
  )!
  const tauSingle = comparisonRows.find(
    (r) =>
      r.benchmarkId === "tau-retail" &&
      r.architectureId === "single-agent",
  )!
  const tauMulti = comparisonRows.find(
    (r) =>
      r.benchmarkId === "tau-retail" &&
      r.architectureId === "orchestrator-workers",
  )!

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-mm-dark">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Single vs multi-agent results by benchmark. Success, cost, latency.
          </p>
        </div>
        <Button
          render={<Link href="/compare" />}
          className="h-9 bg-mm-charge px-3 text-sm font-medium"
        >
          Compare
          <ArrowRight className="size-4" />
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CompareCard
          benchmarkLabel="Finance Agent Benchmark"
          structureLabel="Breadth-first research"
          single={fabSingle}
          multi={fabMulti}
          badge={`+${(fabMulti.success - fabSingle.success).toFixed(1)} pts success`}
          badgeClass="bg-mm-green/15 text-[#2f7a1f]"
        />
        <CompareCard
          benchmarkLabel="τ-bench Retail"
          structureLabel="Human-facing tool use"
          single={tauSingle}
          multi={tauMulti}
          badge={`${(tauMulti.latencySec / tauSingle.latencySec).toFixed(1)}x slower multi`}
          badgeClass="bg-mm-orange/15 text-[#b34800]"
        />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-mm-dark">Task types</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {taskRegimes.map((regime) => (
            <div
              key={regime.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <p className="font-semibold text-mm-dark">{regime.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {regime.structure}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Priority: {regime.priority}
              </p>
              <p className="mt-1 text-sm text-mm-dark">
                Lean:{" "}
                {regime.leanArchitecture === "single-agent"
                  ? "Single agent"
                  : regime.leanArchitecture === "multi-agent"
                    ? "Multi-agent"
                    : "Depends on case"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold text-mm-dark">
            Framework checks
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          {frameworkGates.map((gate, i) => (
            <div
              key={gate.id}
              className={`px-5 py-4 ${
                i < frameworkGates.length - 1
                  ? "border-b border-border lg:border-b-0 lg:border-r"
                  : ""
              } ${i % 2 === 0 ? "sm:border-r" : ""} ${i < 2 ? "sm:border-b lg:border-b-0" : ""}`}
            >
              <p className="font-semibold text-mm-dark">{gate.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{gate.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-mm-dark">Recent runs</h2>
          <Button
            render={<Link href="/runs" />}
            variant="ghost"
            className="h-8 text-sm text-mm-charge"
          >
            All runs
            <ArrowRight className="size-4" />
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Run</th>
                <th className="px-4 py-2.5 font-medium">Benchmark</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                  Architecture
                </th>
                <th className="px-4 py-2.5 font-medium">Success</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                  $/success
                </th>
                <th className="px-4 py-2.5 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.slice(0, 5).map((run) => {
                const bench = getBenchmark(run.benchmarkId)
                const arch = getArchitecture(run.architectureId)
                return (
                  <tr
                    key={run.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-mm-blue">
                      {run.id}
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {bench?.shortName}
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                      {arch?.label}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatPct(run.success)}
                    </td>
                    <td className="hidden px-4 py-2.5 tabular-nums sm:table-cell">
                      {formatUsd(run.costPerSuccess)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatLatency(run.latencySec)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
