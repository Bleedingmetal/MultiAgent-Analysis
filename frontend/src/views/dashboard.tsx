"use client"

/*
 * Overview: a quick look before diving in, or a last look after a session.
 *
 * 1. One headline per task: its best result, and single vs multi-agent compared only on the
 *    questions both ran (from /api/overview, paired question by question).
 * 2. Discover insights: the questions panel, the page's centrepiece.
 * 3. What changed, and what needs attention (shown only when something does).
 *
 * The full leaderboard and coverage table live on Compare. Every number opens its evidence in
 * the side panel shared with Compare.
 */

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { pct, usd, when } from "@/components/product/batch-results"
import { DiscoverInsights } from "@/components/product/discover-insights"
import {
  type BatchRun,
  type Overview,
  type OverviewAttention,
  type OverviewTask,
  benchmarkName,
  getHealth,
  getOverview,
  listBatches,
  planSettle,
  runSettle,
  type SettlePlan,
  setOverviewHidden,
  taskNoun,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { HowThisWorks, type Row, SidePanel, arch, btnPrimary, btnQuiet, leaderboard, surface } from "@/views/compare"

type Health = Awaited<ReturnType<typeof getHealth>>

const BENCH_ORDER = ["finqa", "tau2-retail", "tau-retail", "fab"]
/** Tasks in plain words; the benchmark is named beside them. */
const TASK: Record<string, string> = {
  finqa: "Financial calculation",
  "tau2-retail": "Customer service with tools",
  "tau-retail": "Customer service",
  fab: "Finance research",
}
const task = (id: string) => TASK[id] ?? benchmarkName(id)
/** Short benchmark names, so every headline stays on one line and the figures line up. */
const SHORT: Record<string, string> = { finqa: "FinQA", "tau2-retail": "τ²-bench", "tau-retail": "τ-bench", fab: "FAB v2.1" }
const byBench = (a: string, b: string) => (BENCH_ORDER.indexOf(a) + 1 || 99) - (BENCH_ORDER.indexOf(b) + 1 || 99)

/** The headline panel keeps every task in one row from lg (two on md, stacked on phones). */
const HEADLINE_GRID: Record<number, string> = {
  1: "",
  2: "md:grid-cols-2 md:divide-x md:divide-border/70",
  3: "xl:grid-cols-3 xl:divide-x xl:divide-border/70",
  4: "md:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border/70",
}
const link =
  "cursor-pointer rounded-[4px] font-medium text-mm-charge hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [batches, setBatches] = useState<BatchRun[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    return Promise.all([getOverview(), listBatches(undefined, 200), getHealth()])
      .then(([o, b, h]) => {
        setOverview(o)
        setBatches(b.batches)
        setHealth(h)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the overview"))
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  // While runs go (top-ups settling a comparison included), keep the page current
  const busy = !!overview && (overview.running > 0 || !!overview.settling)
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(() => void load(), 4000)
    return () => window.clearTimeout(t)
  }, [busy, overview, load])

  const hidden = useMemo(() => new Set(overview?.hidden_configuration_ids ?? []), [overview])
  // Hidden configurations (tests, scratch setups) stay off the Overview; Compare shows them all.
  // Top-up runs only supplement a comparison, so they never rank.
  const board = useMemo(
    () => leaderboard(batches.filter((b) => !hidden.has(b.configuration_id) && b.purpose !== "top-up")),
    [batches, hidden],
  )
  const tasks = useMemo(() => [...(overview?.tasks ?? [])].sort((a, b) => byBench(a.benchmark_id, b.benchmark_id)), [overview])
  const benches = tasks.map((t) => t.benchmark_id)
  const open = openId ? board.find((r) => r.batch.id === openId) ?? null : null
  const openBaseline = open
    ? board.find((r) => r.eligible && r.batch.benchmark_id === open.batch.benchmark_id && r.batch.architecture === "single-agent") ?? null
    : null

  async function hide(configurationId: string) {
    await setOverviewHidden(configurationId, true).catch(() => undefined)
    setOpenId(null)
    void load()
  }
  async function showAll() {
    await Promise.all([...hidden].map((id) => setOverviewHidden(id, false))).catch(() => undefined)
    void load()
  }

  const loading = !overview && !error
  return (
    <div className={cn("mx-auto w-full max-w-[1180px] transition-[padding] duration-200", openId && "xl:pr-[440px]")}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6">
        <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Agent Evaluation</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <HowThisWorks benches={benches} className="" />
          {health?.spend ? (
            <span className="text-[12px] text-muted-foreground">
              {usd(health.spend.remaining_budget_usd)} of today&rsquo;s {usd(health.spend.daily_budget_usd)} left
            </span>
          ) : null}
          <Link href="/configurations" className={cn(btnPrimary, "cursor-pointer")}>
            Run an evaluation
          </Link>
        </div>
      </header>

      {error ? (
        <div className={cn("mt-6 flex flex-wrap items-center justify-between gap-3 px-6 py-5 text-[13px]", surface)}>
          <span className="text-mm-dark">The overview couldn&rsquo;t load: {error}</span>
          <button type="button" onClick={() => void load()} className={cn(btnQuiet, "cursor-pointer")}>
            Try again
          </button>
        </div>
      ) : null}

      {/* 1 · Where each task stands */}
      {loading ? (
        <div className={cn("mt-6 grid gap-8 p-6 lg:grid-cols-3", surface)} aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-8 w-28 animate-pulse rounded bg-muted" />
              <div className="h-3 w-56 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : tasks.length ? (
        <div className={cn("mt-6 grid gap-x-0 gap-y-10 px-6 py-7", surface, HEADLINE_GRID[Math.min(tasks.length, 4)])}>
          {tasks.map((t) => (
            <Headline key={t.benchmark_id} t={t} rows={board.filter((r) => r.batch.benchmark_id === t.benchmark_id)} onOpen={setOpenId} />
          ))}
        </div>
      ) : overview ? (
        <div className={cn("mt-6 px-6 py-8 text-[13px] text-mm-dark", surface)}>
          No complete runs yet. Run a configuration on a benchmark to see where things stand.
        </div>
      ) : null}

      {/* 2 · Discover insights: pick a question, get the chart that answers it */}
      {benches.length ? (
        <DiscoverInsights board={board} benches={benches} selectedId={openId} onOpen={setOpenId} archLabel={(a) => arch(a).label} tabLabel={task} />
      ) : null}

      {/* 3 · What changed, and what needs attention */}
      {overview && overview.recent.length ? (
        <div className={cn("mt-4 grid grid-cols-[minmax(0,1fr)] gap-4", overview.attention.length > 0 && "lg:grid-cols-2")}>
          <section className={cn("min-w-0 px-6 pt-5 pb-4", surface)} aria-labelledby="changed-title">
            <h3 id="changed-title" className="text-[15px] font-semibold text-mm-dark">
              What changed
            </h3>
            <ul className="-mx-3 mt-3 divide-y divide-border/60 border-t border-border/70">
              {overview.recent.map((r) => (
                <li key={r.batch_id}>
                  <Link
                    href={`/runs/e2e/${r.batch_id}`}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-mm-dark">{r.configuration_name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {arch(r.architecture).label} · {task(r.benchmark_id)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-data text-[13px] text-mm-dark">
                        {r.status === "running" || r.status === "paused" ? `${r.done} of ${r.total}` : pct(r.accuracy, 1)}
                      </span>
                      {r.not_finished ? (
                        <span className="block text-[12px] text-muted-foreground">{r.not_finished}</span>
                      ) : r.change != null && Math.abs(r.change) >= 0.0005 ? (
                        <span className="block font-data text-[12px] text-muted-foreground">
                          {r.change > 0 ? "+" : "−"}
                          {Math.abs(r.change * 100).toFixed(1)} points
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden w-[6.5rem] shrink-0 text-right text-[12px] text-muted-foreground sm:block">{when(r.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/runs" className={cn("mt-3 inline-block text-[12px]", link)}>
              All runs
            </Link>
          </section>

          {overview.attention.length ? (
            <section className={cn("min-w-0 px-6 pt-5 pb-4", surface)} aria-labelledby="attention-title">
              <h3 id="attention-title" className="text-[15px] font-semibold text-mm-dark">
                Needs attention
              </h3>
              <ul className="mt-3 divide-y divide-border/60 border-t border-border/70">
                {overview.attention.map((a) => (
                  <Attention
                    key={`${a.kind}-${a.benchmark_id}-${"batch_id" in a ? a.batch_id : ""}`}
                    a={a}
                    busy={busy}
                    onSettled={() => void load()}
                    onHide={(batchId) => {
                      const b = batches.find((x) => x.id === batchId)
                      if (b) void hide(b.configuration_id)
                    }}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {hidden.size ? (
        <p className="mt-4 px-6 text-[12px] text-muted-foreground">
          {hidden.size} {hidden.size === 1 ? "configuration is" : "configurations are"} hidden from the Overview.{" "}
          <button type="button" onClick={() => void showAll()} className={link}>
            Show all
          </button>
        </p>
      ) : null}

      <SidePanel
        row={open}
        baseline={openBaseline}
        onClose={() => setOpenId(null)}
        actions={
          open ? (
            <button type="button" onClick={() => void hide(open.batch.configuration_id)} className={cn(btnQuiet, "cursor-pointer")}>
              Hide from Overview
            </button>
          ) : null
        }
      />
    </div>
  )
}

type Side = { label: string; value: number | null; batchId?: string; note?: string; lead: boolean }

/**
 * One task in three rows: the task; single vs multi-agent as two numbers, on the questions both
 * ran (the higher one in full ink, each opening its run); and one line of context. The rows sit
 * on a subgrid so they line up across tasks.
 */
function Headline({ t, rows, onOpen }: { t: OverviewTask; rows: Row[]; onOpen: (batchId: string) => void }) {
  const { sides, line, detail, partial } = compareSides(t, rows)
  return (
    <section className="row-span-3 grid min-w-0 grid-rows-subgrid gap-y-2.5 xl:px-7 xl:first:pl-0 xl:last:pr-0">
      <p className="truncate text-[13px] text-muted-foreground">
        {task(t.benchmark_id)} · {SHORT[t.benchmark_id] ?? benchmarkName(t.benchmark_id)}
        {t.approximate ? (
          <span className="cursor-help" title="Graded by our judge, not the official one; not comparable with the vals.ai leaderboard">
            , approximate grading
          </span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-x-6">
        {sides.map((side) => {
          const figure = (
            <>
              <span className="block text-[12px] text-muted-foreground">{side.label}</span>
              <span
                className={cn(
                  "mt-0.5 block text-[26px] font-semibold leading-none tracking-[-0.01em] tabular-nums",
                  side.value == null ? "text-muted-foreground/70" : "text-mm-dark",
                )}
              >
                {side.value == null ? "—" : pct(side.value, 1)}
              </span>
              {side.note ? <span className="mt-1 block text-[12px] text-muted-foreground">{side.note}</span> : null}
            </>
          )
          return side.batchId ? (
            <button
              key={side.label}
              type="button"
              onClick={() => onOpen(side.batchId!)}
              className="cursor-pointer self-start rounded-[6px] text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"
              aria-label={`${side.label}: ${side.value == null ? "no result" : pct(side.value, 1)}. Open its run`}
            >
              {figure}
            </button>
          ) : (
            <div key={side.label}>{figure}</div>
          )
        })}
      </div>
      <p className="text-[13px] leading-snug text-pretty text-mm-dark" title={detail}>
        {line}
        {partial ? (
          <>
            {" "}
            <button type="button" onClick={() => onOpen(partial.batch.id)} className={link}>
              Open it
            </button>
          </>
        ) : null}
      </p>
    </section>
  )
}

/** Single vs multi-agent as two numbers, on the questions both ran where they overlap. */
function compareSides(t: OverviewTask, rows: Row[]) {
  const noun = taskNoun(t.benchmark_id, 2)
  const single = t.single, multi = t.multi
  const c = t.comparison
  const partial = !multi ? rows.find((r) => !r.eligible && r.batch.architecture !== "single-agent") : undefined
  if (c && c.comparable) {
    const multiLeads = c.difference > 0
    const cost = costClause(
      multiLeads ? c.multi_cost_per_correct_usd : c.single_cost_per_correct_usd,
      multiLeads ? c.single_cost_per_correct_usd : c.multi_cost_per_correct_usd,
    ).replace(/^, /, "")
    return {
      sides: [
        { label: "Single agent", value: c.single_accuracy, batchId: single?.batch_id, lead: c.difference <= 0 },
        { label: `Multi-agent (${arch(multi!.architecture).label})`, value: c.multi_accuracy, batchId: multi?.batch_id, lead: c.difference >= 0 },
      ] as Side[],
      // "Same 10 questions · single agent cost about a third as much"
      line: `Same ${c.shared} ${noun}${cost ? ` · ${multiLeads ? "multi-agent" : "single agent"} cost ${asMuch(cost)}` : ""}`,
      detail: c.more_questions
        ? `About ${c.more_questions} more ${taskNoun(t.benchmark_id, c.more_questions)} would settle it${c.cost_to_settle_usd ? ` (about ${usd(c.cost_to_settle_usd)})` : ""}.`
        : undefined,
      partial: undefined,
    }
  }
  return {
    sides: [
      { label: "Single agent", value: single?.accuracy ?? null, batchId: single?.batch_id, lead: true },
      {
        label: multi ? `Multi-agent (${arch(multi.architecture).label})` : "Multi-agent",
        value: multi?.accuracy ?? null,
        batchId: multi?.batch_id,
        lead: !single,
      },
    ] as Side[],
    line: !t.best
      ? "No complete run yet."
      : partial
        ? `The multi-agent run didn’t finish (${partialReason(partial)}).`
        : !multi
          ? "No multi-agent run yet."
          : !single
            ? "No single-agent run yet."
            : `They haven’t run the same ${noun} yet, so these aren’t compared.`,
    detail: undefined,
    partial,
  }
}

/** "at about a third of the cost" -> "about a third as much"; "at 2.1× the cost" -> "2.1× as much". */
function asMuch(clause: string) {
  return clause
    .replace(/^at /, "")
    .replace("about the same cost", "about the same")
    .replace(/ of the cost$/, " as much")
    .replace(/ the cost$/, " as much")
}

function partialReason(r: Row) {
  const s = r.batch.summary
  if (s.errors) return `${s.errors} of ${r.batch.size} didn’t run`
  return "it stopped early"
}

function costClause(lead: number | null, other: number | null) {
  if (!lead || !other) return ""
  const r = lead / other
  if (r > 0.9 && r < 1.1) return ", at about the same cost"
  if (r >= 1.1) return `, at ${r.toFixed(1)}× the cost`
  const fractions: [number, string][] = [
    [1 / 2, "half"],
    [1 / 3, "a third of"],
    [1 / 4, "a quarter of"],
    [1 / 5, "a fifth of"],
  ]
  const near = fractions.find(([f]) => Math.abs(r - f) / f < 0.15)
  return near ? `, at about ${near[1]} the cost` : `, at ${Math.round(r * 100)}% of the cost`
}

/** "stopped early: Reached the $0.00 spend cap for this run." -> "stopped early (reached …)" */
function reason(text: string) {
  const m = text.match(/^stopped early: (.+?)\.?$/)
  return m ? `stopped early (${m[1].charAt(0).toLowerCase()}${m[1].slice(1)})` : text
}

/** One attention item: a plain sentence and one action. */
function Attention({
  a,
  busy,
  onHide,
  onSettled,
}: {
  a: OverviewAttention
  busy: boolean
  onHide: (batchId: string) => void
  onSettled: () => void
}) {
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[13px] leading-snug"
  if (a.kind === "unfinished") {
    return (
      <li className={row}>
        <span className="min-w-0 flex-1 text-pretty text-mm-dark">
          {a.configuration_name} on {task(a.benchmark_id)}: {reason(a.reason)}.
        </span>
        <span className="flex shrink-0 items-center gap-3 text-[12px]">
          <Link href={`/runs/e2e/${a.batch_id}`} className={link}>
            Open run
          </Link>
          <button type="button" onClick={() => onHide(a.batch_id)} className="cursor-pointer text-muted-foreground hover:text-mm-dark hover:underline">
            Hide
          </button>
        </span>
      </li>
    )
  }
  if (a.kind === "too-close") {
    return <TooClose a={a} row={row} busy={busy} onSettled={onSettled} />
  }
  return (
    <li className={row}>
      <span className="min-w-0 flex-1 text-pretty text-mm-dark">
        {task(a.benchmark_id)}: single and multi-agent haven&rsquo;t run the same {taskNoun(a.benchmark_id, 2)} yet.
      </span>
      <Link href="/runs" className={cn("shrink-0 text-[12px]", link)}>
        Open runs
      </Link>
    </li>
  )
}

/** "Runs 8 more FinQA questions on A (B already has them). About $0.0037." */
function planSentence(p: SettlePlan) {
  const noun = (n: number) => `${SHORT[p.benchmark_id] ?? benchmarkName(p.benchmark_id)} ${taskNoun(p.benchmark_id, n)}`
  const todo = p.sides.filter((s) => s.missing > 0)
  const done = p.sides.filter((s) => s.missing === 0)
  let what: string
  if (todo.length === 2 && todo[0].missing === todo[1].missing) {
    what = `Runs ${todo[0].missing} more ${noun(todo[0].missing)} on each of ${todo[0].configuration_name} and ${todo[1].configuration_name}.`
  } else if (todo.length === 2) {
    what = `Runs ${todo[0].missing} more ${noun(todo[0].missing)} on ${todo[0].configuration_name} and ${todo[1].missing} on ${todo[1].configuration_name}.`
  } else if (todo.length === 1) {
    const t = todo[0]
    what = `Runs ${t.missing} more ${noun(t.missing)} on ${t.configuration_name}${done.length ? ` (${done[0].configuration_name} already has them)` : ""}.`
  } else {
    return "Both sides already have these questions."
  }
  return `${what} About ${usd(p.total_estimated_cost_usd)}.`
}

function plainError(e: unknown) {
  const m = e instanceof Error ? e.message : "Something went wrong."
  return /[.!?]$/.test(m) ? m : `${m}.`
}

type SettleState =
  | { step: "idle" }
  | { step: "planning" }
  | { step: "plan"; plan: SettlePlan }
  | { step: "starting"; plan: SettlePlan }
  | { step: "running"; batchId: string; seenBusy: boolean }
  | { step: "error"; message: string }

const quietButton =
  "cursor-pointer rounded-[4px] text-muted-foreground hover:text-mm-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"

/** A too-close comparison and "Settle it": the plan opens inline, then the missing questions run. */
function TooClose({
  a,
  row,
  busy,
  onSettled,
}: {
  a: Extract<OverviewAttention, { kind: "too-close" }>
  row: string
  busy: boolean
  onSettled: () => void
}) {
  const [state, setState] = useState<SettleState>({ step: "idle" })
  const more = a.more_questions

  // When the top-ups are done, reload so the comparison takes them in
  useEffect(() => {
    if (state.step !== "running") return
    if (busy && !state.seenBusy) setState({ ...state, seenBusy: true })
    else if (!busy && state.seenBusy) {
      setState({ step: "idle" })
      onSettled()
    }
  }, [busy, state, onSettled])

  async function plan() {
    setState({ step: "planning" })
    try {
      setState({ step: "plan", plan: await planSettle(a.benchmark_id) })
    } catch (e) {
      setState({ step: "error", message: plainError(e) })
    }
  }
  async function run(p: SettlePlan) {
    setState({ step: "starting", plan: p })
    try {
      const res = await runSettle(a.benchmark_id)
      setState({ step: "running", batchId: res.batch_id, seenBusy: false })
      onSettled() // reload now, so the page sees the run going
    } catch (e) {
      setState({ step: "error", message: plainError(e) })
    }
  }

  return (
    <li className={row}>
      <span className="min-w-0 flex-1 text-pretty text-mm-dark">
        {task(a.benchmark_id)}: single vs multi-agent is too close to call.
        {more ? ` About ${more} more ${taskNoun(a.benchmark_id, more)} would settle it.` : ""}
      </span>
      {state.step === "idle" || state.step === "planning" ? (
        <button
          type="button"
          onClick={() => void plan()}
          disabled={state.step === "planning"}
          className={cn("shrink-0 text-[12px] disabled:cursor-wait disabled:opacity-60", link)}
        >
          Settle it
        </button>
      ) : null}
      {state.step === "running" ? (
        <span className="shrink-0 text-[12px] text-muted-foreground">
          Running ·{" "}
          <Link href={`/runs/e2e/${state.batchId}`} className={link}>
            open run
          </Link>
        </span>
      ) : null}
      {state.step === "plan" || state.step === "starting" ? (
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <span className="min-w-0 flex-1 text-pretty text-muted-foreground">{planSentence(state.plan)}</span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => void run(state.plan)}
              disabled={state.step === "starting" || state.plan.sides.every((s) => s.missing === 0)}
              className={cn(
                btnPrimary,
                "h-8 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40 disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {state.step === "starting" ? "Starting…" : "Run it"}
            </button>
            <button type="button" onClick={() => setState({ step: "idle" })} className={cn("text-[12px]", quietButton)}>
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {state.step === "error" ? (
        <div className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 pt-1">
          <span className="min-w-0 flex-1 text-pretty text-mm-dark">{state.message}</span>
          <button type="button" onClick={() => setState({ step: "idle" })} className={cn("shrink-0 text-[12px]", quietButton)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </li>
  )
}
