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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-mm-dark">
          Runs
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evaluation runs by benchmark and architecture.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Run</th>
              <th className="px-4 py-2.5 font-medium">Benchmark</th>
              <th className="px-4 py-2.5 font-medium">Architecture</th>
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">
                Model
              </th>
              <th className="px-4 py-2.5 font-medium">Success</th>
              <th className="px-4 py-2.5 font-medium">$/success</th>
              <th className="px-4 py-2.5 font-medium">Latency</th>
              <th className="px-4 py-2.5 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((run) => {
              const bench = getBenchmark(run.benchmarkId)
              const arch = getArchitecture(run.architectureId)
              return (
                <tr
                  key={run.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 font-mono text-xs text-mm-blue">
                    {run.id}
                  </td>
                  <td className="px-4 py-3 font-medium">{bench?.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {arch?.label}
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground lg:table-cell">
                    {run.model}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatPct(run.success)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatUsd(run.costPerSuccess)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatLatency(run.latencySec)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex rounded-full bg-mm-green/15 px-2 py-0.5 text-[11px] font-semibold text-[#2f7a1f]">
                      {run.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
