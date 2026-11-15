"use client"

/*
 * Overview, in the app style "Achromatic ledger" (tasteskill, seed 411890543): ink chrome,
 * figures in the mono face, the one blue on the main data element, near-black primary.
 *
 * Built for progressive disclosure. The first screen says four numbers and one sentence.
 * Each compared configuration is one row with its pass rate and cost; clicking a row opens
 * a dialog with everything else about that run (outcomes per question, passes, latency,
 * tokens, errors) and the links onward. Nothing below the fold repeats what is above it.
 */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { STATUS_STYLE, pct, secs, usd, when } from "@/components/product/batch-results"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type BatchRun,
  type RunResult,
  benchmarkName,
  getBatch,
  getHealth,
  listBatches,
  listRuns,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type Health = Awaited<ReturnType<typeof getHealth>>

const ARCH_LABEL: Record<string, string> = {
  "single-agent": "Single agent",
  "prompt-chaining": "Prompt chain",
  routing: "Routing",
  parallelization: "Parallel",
  "evaluator-optimizer": "Evaluator",
  "autonomous-agent": "Autonomous",
  custom: "Custom",
}

const FINISHED = new Set<BatchRun["status"]>(["completed", "stopped", "cancelled", "interrupted"])
const BENCH_ORDER = ["finqa", "tau2-retail", "tau-retail"]

function archLabel(id: string) {
  return ARCH_LABEL[id] ?? id
}

/** The latest finished end-to-end run of each configuration: the row it is judged by. */
function latestPerConfiguration(batches: BatchRun[]) {
  const seen = new Map<string, BatchRun>()
  for (const b of [...batches].sort((a, c) => c.created_at.localeCompare(a.created_at))) {
    if (!FINISHED.has(b.status) || b.summary.passed + b.summary.failed === 0) continue
    if (!seen.has(b.configuration_id)) seen.set(b.configuration_id, b)
  }
  return [...seen.values()].sort((a, b) => (b.summary.pass_rate ?? 0) - (a.summary.pass_rate ?? 0))
}

function mean(values: (number | null | undefined)[]) {
  const nums = values.filter((v): v is number => v != null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

function sideStats(rows: BatchRun[]) {
  return {
    n: rows.length,
    pass: mean(rows.map((b) => b.summary.pass_rate)),
    cost: mean(rows.map((b) => b.summary.cost_per_pass_usd)),
    latency: mean(rows.map((b) => b.summary.p50_latency_sec)),
  }
}

const card = "rounded-lg border border-[#e3e8ef] bg-white"

export default function Dashboard() {
  const [runs, setRuns] = useState<RunResult[]>([])
  const [batches, setBatches] = useState<BatchRun[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listRuns(100), listBatches(undefined, 100), getHealth()])
      .then(([r, b, h]) => {
        if (cancelled) return
        setRuns(r.runs)
        setBatches(b.batches)
        setHealth(h)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  const board = useMemo(() => latestPerConfiguration(batches), [batches])
  const benches = useMemo(
    () =>
      [...new Set(board.map((b) => b.benchmark_id))].sort(
        (a, b) => (BENCH_ORDER.indexOf(a) + 1 || 99) - (BENCH_ORDER.indexOf(b) + 1 || 99),
      ),
    [board],
  )

  const totals = useMemo(() => {
    const scored = batches.reduce((n, b) => n + b.summary.passed + b.summary.failed, 0)
    const passed = batches.reduce((n, b) => n + b.summary.passed, 0)
    const questions = batches.reduce((n, b) => n + b.summary.done, 0) + runs.length
    const spend = batches.reduce((n, b) => n + b.summary.cost_usd, 0) + runs.reduce((n, r) => n + r.cost_usd, 0)
    return { scored, passed, questions, spend, passRate: scored ? passed / scored : null }
  }, [batches, runs])

  const sides = useMemo(() => {
    const single = sideStats(board.filter((b) => b.architecture === "single-agent"))
    const multi = sideStats(board.filter((b) => b.architecture !== "single-agent"))
    return single.n && multi.n ? { single, multi } : null
  }, [board])

  const recent = useMemo(() => {
    const rows = [
      ...batches.map((b) => ({ kind: "batch" as const, at: b.created_at, batch: b })),
      ...runs.map((r) => ({ kind: "run" as const, at: r.created_at, run: r })),
    ]
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [batches, runs])

  const lead = board[0]
  const finding = lead
    ? `${lead.configuration_name} leads ${benchmarkName(lead.benchmark_id)}: ${pct(lead.summary.pass_rate, 1)} of ${lead.summary.passed + lead.summary.failed} answers correct, at ${usd(lead.summary.cost_per_pass_usd)} per correct answer.`
    : loaded
      ? "Nothing has been evaluated end-to-end yet."
      : ""
  const open = openId ? board.find((b) => b.id === openId) ?? null : null

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Findings so far</h2>
          {finding ? <p className="mt-1.5 max-w-[64ch] text-[15px] text-mm-dark">{finding}</p> : null}
          {error ? <p className="mt-1.5 text-sm text-[#b34800]">{error}</p> : null}
        </div>
        <Link
          href="/configurations"
          className="inline-flex h-9 items-center rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black"
        >
          Run an evaluation
        </Link>
      </div>

      <dl className={cn("mt-6 grid grid-cols-2 divide-[#e3e8ef] lg:grid-cols-4 lg:divide-x", card)}>
        <Kpi label="End-to-end runs" value={String(batches.length)} caption={`${runs.length} single-question ${runs.length === 1 ? "run" : "runs"} besides`} />
        <Kpi label="Questions evaluated" value={totals.questions.toLocaleString()} caption={benches.length ? benches.map(benchmarkName).join(", ") : "all benchmarks"} />
        <Kpi label="Pass rate" value={pct(totals.passRate, 1)} caption={totals.scored ? `${totals.passed} of ${totals.scored} scored answers` : "nothing scored yet"} />
        <Kpi
          label="Spent"
          value={usd(totals.spend)}
          caption={health?.spend ? `today ${usd(health.spend.spend_usd)} of the ${usd(health.spend.daily_budget_usd)} daily budget` : "all runs"}
        />
      </dl>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_384px]">
        <div className="min-w-0 space-y-4">
          {/* The screen's question: which configuration does best, per benchmark. One row each; click for the rest. */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-1">
              <h3 className="text-[16px] font-semibold text-mm-dark">Configurations compared</h3>
              <span className="text-[12px] text-muted-foreground">latest run of each · click a row for details</span>
            </div>
            {board.length ? (
              benches.map((id) => {
                const group = board.filter((b) => b.benchmark_id === id)
                const best = group[0]
                return (
                  <div key={id} className="border-t border-[#eef1f5]">
                    {benches.length > 1 ? (
                      <p className="px-5 pt-3 text-[12px] font-medium text-muted-foreground">{benchmarkName(id)}</p>
                    ) : null}
                    <ul>
                      {group.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => setOpenId(b.id)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_minmax(120px,38%)_84px] items-center gap-4 px-5 py-3 text-left hover:bg-[#f7f9fc] focus-visible:bg-[#f7f9fc] focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_minmax(160px,38%)_84px_96px]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[14px] font-medium text-mm-dark">{b.configuration_name}</span>
                              <span className="block truncate text-[12px] text-muted-foreground">
                                {archLabel(b.architecture)} · {b.models.join(", ") || b.mode}
                              </span>
                            </span>
                            <span className="flex items-center gap-3">
                              <span className="h-[14px] flex-1 overflow-hidden rounded-r-[4px] bg-[#edf0f4]">
                                <span
                                  className={cn("block h-full rounded-r-[4px]", b === best ? "bg-[#1d5fbf]" : "bg-[#8d97aa]")}
                                  style={{ width: `${Math.max(1, (b.summary.pass_rate ?? 0) * 100)}%` }}
                                />
                              </span>
                              <span className="w-11 text-right font-data text-[13px] text-mm-dark">{pct(b.summary.pass_rate, 0)}</span>
                            </span>
                            <span className="text-right font-data text-[13px] text-mm-dark">
                              {usd(b.summary.cost_per_pass_usd)}
                              <span className="block text-[11px] font-sans text-muted-foreground">per correct</span>
                            </span>
                            <span className="hidden text-right font-data text-[13px] text-mm-dark sm:block">
                              {secs(b.summary.p50_latency_sec)}
                              <span className="block text-[11px] font-sans text-muted-foreground">median</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })
            ) : (
              <p className="mx-5 mb-5 mt-3 rounded-md border border-dashed border-[#d1d7e0] px-4 py-6 text-center text-[13px] text-muted-foreground">
                {loaded ? "No end-to-end runs yet. Open a configuration and run it end-to-end on FinQA or τ-bench." : "Loading…"}
              </p>
            )}
          </section>

          {/* The project's question, as one line; the numbers behind it on demand */}
          {sides ? (
            <details className={cn(card, "group")}>
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span className="text-[15px] text-mm-dark">
                  Multi-agent configurations average{" "}
                  <span className="font-data">{pct(sides.multi.pass, 0)}</span> against{" "}
                  <span className="font-data">{pct(sides.single.pass, 0)}</span> for single agents, at{" "}
                  <span className="font-data">{usd(sides.multi.cost)}</span> vs{" "}
                  <span className="font-data">{usd(sides.single.cost)}</span> per correct answer.
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground group-open:hidden">Show the numbers</span>
                <span className="hidden shrink-0 text-[12px] text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <table className="w-full border-t border-[#eef1f5] text-[13px]">
                <thead className="text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-normal">Average of the configurations run</th>
                    <th className="px-3 py-2 text-right font-normal">Single agent ({sides.single.n})</th>
                    <th className="px-5 py-2 text-right font-normal">Multi-agent ({sides.multi.n})</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Pass rate", pct(sides.single.pass, 1), pct(sides.multi.pass, 1)],
                      ["Cost per correct answer", usd(sides.single.cost), usd(sides.multi.cost)],
                      ["Median time per question", secs(sides.single.latency), secs(sides.multi.latency)],
                    ] as const
                  ).map(([label, a, b]) => (
                    <tr key={label} className="border-t border-[#eef1f5]">
                      <td className="px-5 py-2.5 text-mm-dark">{label}</td>
                      <td className="px-3 py-2.5 text-right font-data text-mm-dark">{a}</td>
                      <td className="px-5 py-2.5 text-right font-data text-mm-dark">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-[12px] text-muted-foreground">
                Averages across the latest run of each configuration, all benchmarks together; compare rows in the list above for a like-for-like reading.
              </p>
            </details>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <section className={card}>
            <h3 className="px-4 pt-4 pb-2 text-[16px] font-semibold text-mm-dark">Recent activity</h3>
            {recent.length ? (
              <ul className="divide-y divide-[#eef1f5] border-t border-[#eef1f5]">
                {recent.map((row) =>
                  row.kind === "batch" ? (
                    <li key={row.batch.id}>
                      <Link href={`/runs/e2e/${row.batch.id}`} className="flex h-[45px] items-center gap-3 px-4 text-[13px] hover:bg-[#f7f9fc]">
                        <span className="min-w-0 flex-1 truncate text-mm-dark">
                          {row.batch.configuration_name}
                          <span className="text-muted-foreground"> · end-to-end, {row.batch.size}</span>
                        </span>
                        <span className="font-data text-mm-dark">
                          {row.batch.status === "running" ? `${row.batch.summary.done}/${row.batch.summary.total}` : pct(row.batch.summary.pass_rate, 0)}
                        </span>
                        <span className="w-[7rem] shrink-0 whitespace-nowrap text-right font-data text-[12px] text-muted-foreground">{when(row.batch.created_at)}</span>
                      </Link>
                    </li>
                  ) : (
                    <li key={row.run.id}>
                      <Link href={`/runs/${row.run.id}`} className="flex h-[45px] items-center gap-3 px-4 text-[13px] hover:bg-[#f7f9fc]">
                        <span className="min-w-0 flex-1 truncate text-mm-dark">
                          {row.run.configuration_name}
                          <span className="text-muted-foreground"> · {row.run.model}</span>
                        </span>
                        <span className={cn("font-data", row.run.success === false ? "text-[#c4242a]" : "text-mm-dark")}>
                          {row.run.success === true ? "Pass" : row.run.success === false ? "Fail" : "—"}
                        </span>
                        <span className="w-[7rem] shrink-0 whitespace-nowrap text-right font-data text-[12px] text-muted-foreground">{when(row.run.created_at)}</span>
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted-foreground">{loaded ? "No runs yet." : "Loading…"}</p>
            )}
            <Link
              href="/runs"
              className="m-3 flex h-[30px] items-center justify-center rounded-md border border-[#d1d7e0] text-[12px] font-medium text-mm-dark hover:bg-[#f7f9fc]"
            >
              View all
            </Link>
          </section>
        </aside>
      </div>

      <RunDialog batch={open} onClose={() => setOpenId(null)} />
    </div>
  )
}

function Kpi({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[14px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-data text-[24px] leading-none text-mm-dark">{value}</dd>
      <dd className="mt-1.5 text-[12px] text-muted-foreground">{caption}</dd>
    </div>
  )
}

/** Everything about one configuration's latest run, fetched when the dialog opens. */
function RunDialog({ batch, onClose }: { batch: BatchRun | null; onClose: () => void }) {
  const [full, setFull] = useState<BatchRun | null>(null)
  useEffect(() => {
    setFull(null)
    if (!batch) return
    let cancelled = false
    getBatch(batch.id).then((b) => !cancelled && setFull(b)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [batch])
  const b = full ?? batch
  const s = b?.summary
  const passes = b?.passes ?? 1
  const graded = s ? s.passed + s.failed : 0
  const facts: [string, string][] = s
    ? [
        ["Correct", `${s.passed} of ${graded}`],
        ...(passes > 1
          ? ([["Right in every pass", pct(s.pass_all_rate, 0)], ["Right in at least one", pct(s.pass_any_rate, 0)]] as [string, string][])
          : []),
        ["Cost per correct answer", usd(s.cost_per_pass_usd)],
        ["Total cost", usd(s.cost_usd)],
        ["Median time", secs(s.p50_latency_sec)],
        ["Slowest tenth", secs(s.p95_latency_sec)],
        ["Tokens", `${s.prompt_tokens.toLocaleString()} → ${s.completion_tokens.toLocaleString()}`],
        ["Errors", String(s.errors)],
      ]
    : []
  return (
    <Dialog open={!!batch} onOpenChange={(o) => !o && onClose()}>
      {b && s ? (
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-[18px]">{b.configuration_name}</DialogTitle>
            <DialogDescription>
              {archLabel(b.architecture)} · {b.models.join(", ") || b.mode} · {benchmarkName(b.benchmark_id)}, {b.size} {b.size === 1 ? "task" : "tasks"}
              {passes > 1 ? ` × ${passes} passes` : ""} · {when(b.created_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-baseline gap-3">
            <p className="font-data text-[40px] leading-none text-mm-dark">{pct(s.pass_rate, 1)}</p>
            <p className="text-[13px] text-muted-foreground">{passes > 1 ? `mean pass rate over ${passes} full passes` : "pass rate"}</p>
          </div>

          {full?.items.length ? (
            <div>
              <p className="mb-1.5 text-[12px] text-muted-foreground">Outcome per {b.benchmark_id === "finqa" ? "question" : "conversation"}, in run order</p>
              <div className="flex flex-wrap gap-[3px]" aria-label="Outcome per task">
                {full.items.map((item) => (
                  <Link
                    key={item.index}
                    href={`/runs/e2e/${b.id}#batch-item-${item.index}`}
                    title={`#${item.index + 1} · ${STATUS_STYLE[item.status].label}`}
                    className={cn("size-[10px] rounded-[2px] hover:ring-2 hover:ring-mm-dark/40", STATUS_STYLE[item.status].cell)}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {s.passed} passed · {s.failed} failed{s.errors ? ` · ${s.errors} errored` : ""}{s.mixed ? ` · ${s.mixed} flipped between passes` : ""}
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Loading outcomes…</p>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[#eef1f5] pt-4 text-[13px] sm:grid-cols-4">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[12px] text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 truncate font-data text-mm-dark">{value}</dd>
              </div>
            ))}
          </dl>
          {b.stop_reason ? <p className="text-[12px] text-muted-foreground">{b.stop_reason}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-[#eef1f5] pt-4">
            <Link
              href={`/runs/e2e/${b.id}`}
              className="inline-flex h-9 items-center rounded-md bg-[#1d1f20] px-4 text-[13px] font-medium text-white hover:bg-black"
            >
              Open the full run
            </Link>
            <Link
              href={`/configurations/${b.configuration_id}`}
              className="inline-flex h-9 items-center rounded-md border border-[#d1d7e0] px-4 text-[13px] font-medium text-mm-dark hover:bg-[#f7f9fc]"
            >
              Open the configuration
            </Link>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
