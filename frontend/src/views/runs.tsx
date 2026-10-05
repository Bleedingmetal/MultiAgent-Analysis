"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowRight } from "@phosphor-icons/react"

import { Bezel, Reveal } from "@/components/product/ui-bits"
import { listRuns, type RunResult } from "@/lib/api"

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

export default function Runs() {
  const [runs, setRuns] = useState<RunResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await listRuns(100)
        if (!cancelled) setRuns(res.runs)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load runs")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal>
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
          Runs
        </h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Live history from the API. Click a run for prompts, config, and rerun.
        </p>
      </Reveal>

      <Reveal delay={0.06}>
        <Bezel coreClassName="overflow-x-auto">
          {loading ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="px-5 py-8 text-sm text-[#b34800]">{error}</p>
          ) : runs.length === 0 ? (
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
                  <th className="px-5 py-3.5 font-medium">Run</th>
                  <th className="px-5 py-3.5 font-medium">When</th>
                  <th className="px-5 py-3.5 font-medium">Config</th>
                  <th className="px-5 py-3.5 font-medium">Benchmark</th>
                  <th className="px-5 py-3.5 font-medium">Model</th>
                  <th className="px-5 py-3.5 font-medium">Result</th>
                  <th className="px-5 py-3.5 font-medium">Cost</th>
                  <th className="px-5 py-3.5 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/35"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/runs/${run.id}`}
                        className="font-data text-xs font-medium text-mm-blue hover:underline"
                      >
                        {run.id}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {formatWhen(run.created_at)}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-mm-dark">
                      {run.configuration_name}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {run.benchmark_id}
                    </td>
                    <td className="px-5 py-3.5 font-data text-xs text-muted-foreground">
                      {run.model}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          run.success === true
                            ? "bg-mm-green/12 text-[#2f7a1f]"
                            : run.success === false
                              ? "bg-mm-orange/12 text-[#b34800]"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {successLabel(run)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-data">
                      ${run.cost_usd.toFixed(5)}
                    </td>
                    <td className="px-5 py-3.5 font-data">
                      {run.latency_sec}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Bezel>
      </Reveal>
    </div>
  )
}
