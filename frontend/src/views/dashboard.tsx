"use client"

/*
 * Overview, set to the dealt app style "Achromatic ledger" (tasteskill, seed 411890543):
 * no colour in the chrome, figures in the mono face like a ledger's columns, the one
 * blue on the screen's main data element (the pass-rate bars), near-black primary.
 * Layout from the sheet: title row → bare KPI strip split by hairlines → the main
 * card (configurations compared) → next card; a 384px rail whose headings sit
 * outside their cards. Four surfaces in all.
 */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { STATUS_STYLE, pct, secs, usd, when } from "@/components/product/batch-results"
import {
  type BatchRun,
  type RunResult,
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
  return [...seen.values()].sort(
    (a, b) => (b.summary.pass_rate ?? 0) - (a.summary.pass_rate ?? 0),
  )
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

  useEffect(() => {
    let cancelled = false
    Promise.all([listRuns(500), listBatches(undefined, 100), getHealth()])
      .then(([r, b, h]) => {
        if (cancelled) return
        // Question runs of a batch are not in run history, so there is no double counting
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
  const [details, setDetails] = useState<Record<string, BatchRun>>({})

  // The list endpoint omits per-question rows; fetch them for the compared runs
  useEffect(() => {
    let cancelled = false
    const missing = board.filter((b) => !details[b.id]).slice(0, 8)
    if (!missing.length) return
    Promise.all(missing.map((b) => getBatch(b.id).catch(() => null))).then((full) => {
      if (cancelled) return
      setDetails((cur) => {
        const next = { ...cur }
        for (const b of full) if (b) next[b.id] = b
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board])

  const totals = useMemo(() => {
    const scored = batches.reduce((n, b) => n + b.summary.passed + b.summary.failed, 0)
    const passed = batches.reduce((n, b) => n + b.summary.passed, 0)
    const questions = batches.reduce((n, b) => n + b.summary.done, 0) + runs.length
    const spend =
      batches.reduce((n, b) => n + b.summary.cost_usd, 0) +
      runs.reduce((n, r) => n + r.cost_usd, 0)
    return { scored, passed, questions, spend, passRate: scored ? passed / scored : null }
  }, [batches, runs])

  const sides = useMemo(() => {
    const single = sideStats(board.filter((b) => b.architecture === "single-agent"))
    const multi = sideStats(board.filter((b) => b.architecture !== "single-agent"))
    return single.n && multi.n ? { single, multi } : null
  }, [board])

  const findings = useMemo(() => {
    const out: { text: string; figure: string }[] = []
    if (!board.length) return out
    const best = board[0]
    out.push({ text: `Most accurate · ${best.configuration_name}`, figure: pct(best.summary.pass_rate, 1) })
    if (board.length > 1) {
      const cheapest = [...board]
        .filter((b) => b.summary.cost_per_pass_usd != null)
        .sort((a, b) => (a.summary.cost_per_pass_usd ?? 0) - (b.summary.cost_per_pass_usd ?? 0))[0]
      if (cheapest) {
        out.push({ text: `Cheapest per correct answer · ${cheapest.configuration_name}`, figure: usd(cheapest.summary.cost_per_pass_usd) })
      }
      const fastest = [...board]
        .filter((b) => b.summary.p50_latency_sec != null)
        .sort((a, b) => (a.summary.p50_latency_sec ?? 0) - (b.summary.p50_latency_sec ?? 0))[0]
      if (fastest) {
        out.push({ text: `Fastest, median per question · ${fastest.configuration_name}`, figure: secs(fastest.summary.p50_latency_sec) })
      }
    }
    const disputed = batches.reduce((n, b) => n + (b.summary.disputed ?? 0), 0)
    if (disputed) {
      out.push({ text: "FinQA labels that contradicted themselves (either answer accepted)", figure: String(disputed) })
    }
    const errors = batches.reduce((n, b) => n + b.summary.errors, 0)
    if (errors) out.push({ text: "Questions that errored instead of answering", figure: String(errors) })
    return out
  }, [board, batches])

  const recent = useMemo(() => {
    const rows = [
      ...batches.map((b) => ({ kind: "batch" as const, at: b.created_at, batch: b })),
      ...runs.map((r) => ({ kind: "run" as const, at: r.created_at, run: r })),
    ]
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [batches, runs])

  const sizesDiffer = new Set(board.map((b) => b.size)).size > 1
  const lead = board[0]
  const finding = lead
    ? `${lead.configuration_name} leads FinQA: ${pct(lead.summary.pass_rate, 1)} of ${lead.summary.passed + lead.summary.failed} answers correct${(lead.passes ?? 1) > 1 ? ` over ${lead.passes} passes` : ""}, at ${usd(lead.summary.cost_per_pass_usd)} per correct answer.`
    : loaded
      ? "Nothing has been evaluated end-to-end yet."
      : ""

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      {/* Title row: noun, the finding, one primary action */}
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

      {/* Bare KPI strip on the ground, split by hairlines */}
      <dl className={cn("mt-6 grid grid-cols-2 divide-[#e3e8ef] lg:grid-cols-4 lg:divide-x", card)}>
        <Kpi label="End-to-end runs" value={String(batches.length)} caption={`${runs.length} single-question ${runs.length === 1 ? "run" : "runs"} besides`} />
        <Kpi label="Questions evaluated" value={totals.questions.toLocaleString()} caption="FinQA, all runs" />
        <Kpi label="Pass rate" value={pct(totals.passRate, 1)} caption={totals.scored ? `${totals.passed} of ${totals.scored} scored answers` : "nothing scored yet"} />
        <Kpi
          label="Spent"
          value={usd(totals.spend)}
          caption={health?.spend ? `today ${usd(health.spend.spend_usd)} of the ${usd(health.spend.daily_budget_usd)} daily budget` : "all runs"}
        />
      </dl>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_384px]">
        <div className="min-w-0 space-y-4">
          {/* The screen's question, as its largest block */}
          <section className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
              <h3 className="text-[16px] font-semibold text-mm-dark">Configurations compared</h3>
              <span className="text-[12px] text-muted-foreground">latest end-to-end run of each</span>
            </div>
            {board.length ? (
              <>
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[12px] text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 font-normal">Configuration</th>
                      <th className="w-[30%] px-3 py-2 font-normal">Pass rate</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-normal">Per correct</th>
                      <th className="hidden whitespace-nowrap px-3 py-2 text-right font-normal sm:table-cell">Median time</th>
                      <th className="hidden px-5 py-2 text-right font-normal md:table-cell">Questions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((b, i) => (
                      <tr key={b.id} className="border-t border-[#eef1f5] hover:bg-[#f7f9fc]">
                        <td className="px-5 py-3">
                          <Link href={`/runs/e2e/${b.id}`} className="font-medium text-mm-dark hover:underline">
                            {b.configuration_name}
                          </Link>
                          <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
                            {archLabel(b.architecture)} · {b.models.join(", ") || b.mode}
                            {(b.passes ?? 1) > 1 ? ` · ${b.passes} full passes` : ""}
                          </p>
                          {details[b.id]?.items.length ? (
                            <div className="mt-2 flex flex-wrap gap-[2px]" aria-label="Outcome per question">
                              {details[b.id].items.map((item) => (
                                <span
                                  key={item.index}
                                  title={`#${item.index + 1} · ${STATUS_STYLE[item.status].label}`}
                                  className={cn("size-[7px] rounded-[1px]", STATUS_STYLE[item.status].cell)}
                                />
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-[6px] flex-1 rounded-sm bg-[#eef1f5]">
                              <div
                                className={cn("h-full rounded-sm", i === 0 ? "bg-[#1d5fbf]" : "bg-[#1d1f20]")}
                                style={{ width: `${(b.summary.pass_rate ?? 0) * 100}%` }}
                              />
                            </div>
                            <span className="w-14 text-right font-data text-mm-dark">{pct(b.summary.pass_rate, 1)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-data text-mm-dark">{usd(b.summary.cost_per_pass_usd)}</td>
                        <td className="hidden px-3 py-3 text-right font-data text-mm-dark sm:table-cell">{secs(b.summary.p50_latency_sec)}</td>
                        <td className="hidden px-5 py-3 text-right font-data text-muted-foreground md:table-cell">
                          {b.summary.passed + b.summary.failed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sizesDiffer ? (
                  <p className="border-t border-[#eef1f5] px-5 py-3 text-[12px] text-muted-foreground">
                    These runs used different numbers of questions; rerun them on the same size for a fair comparison.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mx-5 mb-5 rounded-md border border-dashed border-[#d1d7e0] px-4 py-6 text-center text-[13px] text-muted-foreground">
                {loaded ? "No end-to-end runs yet. Open a configuration and run it end-to-end on FinQA." : "Loading…"}
              </p>
            )}
          </section>

          {board.length > 1 ? (
            <section className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
                <h3 className="text-[16px] font-semibold text-mm-dark">Accuracy against cost</h3>
                <span className="text-[12px] text-muted-foreground">up and to the left is better</span>
              </div>
              <CostAccuracyChart rows={board} />
            </section>
          ) : null}

          {/* The project's actual question, in two columns */}
          <section className={card}>
            <h3 className="px-5 pt-4 text-[16px] font-semibold text-mm-dark">Single agent against multi-agent</h3>
            {sides ? (
              <table className="mt-2 w-full text-[13px]">
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
            ) : (
              <p className="px-5 pt-2 pb-5 text-[13px] text-muted-foreground">
                {loaded
                  ? "Appears once at least one single-agent and one multi-agent configuration have an end-to-end run."
                  : "Loading…"}
              </p>
            )}
          </section>
        </div>

        {/* Rail */}
        <aside className="min-w-0 space-y-4">
          <section className={card}>
            <h3 className="px-4 pt-4 pb-2 text-[16px] font-semibold text-mm-dark">Findings</h3>
            {findings.length ? (
              <ul className="divide-y divide-[#eef1f5] border-t border-[#eef1f5]">
                {findings.map((f) => (
                  <li key={f.text} className="flex items-baseline justify-between gap-4 px-4 py-3 text-[13px]">
                    <span className="text-mm-dark">{f.text}</span>
                    <span className="shrink-0 font-data text-mm-dark">{f.figure}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted-foreground">
                {loaded ? "Needs a finished end-to-end run." : "Loading…"}
              </p>
            )}
          </section>

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
                          {row.batch.status === "running"
                            ? `${row.batch.summary.done}/${row.batch.summary.total}`
                            : pct(row.batch.summary.pass_rate, 0)}
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

/** Each compared configuration as a dot: pass rate against cost per correct answer (log). */
function CostAccuracyChart({ rows }: { rows: BatchRun[] }) {
  const W = 640, H = 240, L = 44, R = 20, T = 14, B = 36
  const pts = rows
    .filter((b) => b.summary.cost_per_pass_usd != null && b.summary.pass_rate != null)
    .map((b) => ({ b, x: Math.log10(b.summary.cost_per_pass_usd as number), y: b.summary.pass_rate as number }))
  if (!pts.length) return null
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)))
  const x1 = Math.max(Math.ceil(Math.max(...pts.map((p) => p.x))), x0 + 1)
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R)
  const sy = (y: number) => T + (1 - y) * (H - T - B)
  const decades = Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i)
  return (
    <figure className="px-5 pt-2 pb-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Pass rate against cost per correct answer">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="#e5e5e5" strokeWidth={1} />
            <text x={L - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="#5f6368">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {decades.map((d) => (
          <text key={d} x={sx(d)} y={H - 12} textAnchor="middle" fontSize={11} fill="#5f6368">
            {usd(10 ** d)}
          </text>
        ))}
        <line x1={L} x2={W - R} y1={sy(0)} y2={sy(0)} stroke="#1d1f20" strokeWidth={1} />
        {pts.map((p, i) => {
          const cx = sx(p.x), cy = sy(p.y)
          const right = cx < W - R - 140
          return (
            <g key={p.b.id}>
              <circle cx={cx} cy={cy} r={5} fill={i === 0 ? "#1d5fbf" : "#1d1f20"} />
              <text x={right ? cx + 9 : cx - 9} y={cy + 4} textAnchor={right ? "start" : "end"} fontSize={11.5} fill="#001735">
                {p.b.configuration_name}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 text-[12px] text-muted-foreground">
        Cost per correct answer, log scale. One dot per configuration, latest run.
      </figcaption>
    </figure>
  )
}
