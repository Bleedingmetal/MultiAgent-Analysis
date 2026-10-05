"use client"

import { Bezel, Reveal } from "@/components/product/ui-bits"
import {
  formatLatency,
  formatPct,
  formatUsd,
  getArchitecture,
  getBenchmark,
  recentRuns,
} from "@/data/evaluation-mock"

export default function Runs() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal>
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
          Runs
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Evaluation evidence by benchmark and architecture.
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <Bezel coreClassName="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border/70 bg-[#f7f9fc] text-[12px] text-muted-foreground">
              <tr>
                <th className="px-5 py-3.5 font-medium">Run</th>
                <th className="px-5 py-3.5 font-medium">Benchmark</th>
                <th className="px-5 py-3.5 font-medium">Architecture</th>
                <th className="hidden px-5 py-3.5 font-medium lg:table-cell">
                  Model
                </th>
                <th className="px-5 py-3.5 font-medium">Success</th>
                <th className="px-5 py-3.5 font-medium">$/success</th>
                <th className="px-5 py-3.5 font-medium">Latency</th>
                <th className="px-5 py-3.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => {
                const bench = getBenchmark(run.benchmarkId)
                const arch = getArchitecture(run.architectureId)
                return (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-5 py-3.5 font-data text-xs text-mm-blue">
                      {run.id}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-mm-dark">
                      {bench?.name}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {arch?.label}
                    </td>
                    <td className="hidden px-5 py-3.5 font-data text-xs text-muted-foreground lg:table-cell">
                      {run.model}
                    </td>
                    <td className="px-5 py-3.5 font-data">
                      {formatPct(run.success)}
                    </td>
                    <td className="px-5 py-3.5 font-data">
                      {formatUsd(run.costPerSuccess)}
                    </td>
                    <td className="px-5 py-3.5 font-data">
                      {formatLatency(run.latencySec)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="inline-flex rounded-full bg-mm-green/12 px-2.5 py-0.5 text-[11px] font-medium text-[#2f7a1f]">
                        {run.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Bezel>
      </Reveal>
    </div>
  )
}
