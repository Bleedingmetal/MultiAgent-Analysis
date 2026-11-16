"use client"

/*
 * Overview. One question, answered per benchmark: does a multi-agent architecture beat a
 * single agent, and at what price? The page is a lede, a snapshot card per benchmark, the
 * ranked list of configurations, then what ran lately and what has not run at all.
 *
 * Data rules (from the design review): a configuration is judged once per benchmark, by its
 * latest complete run; a run counts only when it finished and graded every task it was given,
 * with at least MIN_N tasks. Anything else is shown as partial and never leads. Pass rates
 * carry n and a 95% Wilson interval. Nothing is averaged across benchmarks.
 *
 * Disclosure: a row opens a side panel that stays open while other rows are clicked, so two
 * configurations are two clicks apart. The panel slides, nothing else animates.
 */

import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { CaretRight, X } from "@phosphor-icons/react"

import { STATUS_STYLE, pct, secs, usd, when } from "@/components/product/batch-results"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  type BatchRun,
  type BenchmarkInfo,
  benchmarkName,
  getBatch,
  getDatasets,
  getHealth,
  listBatches,
  taskNoun,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type Health = Awaited<ReturnType<typeof getHealth>>

/** A run counts for the leaderboard only with this many tasks graded. */
const MIN_N = 10
const BENCH_ORDER = ["finqa", "tau2-retail", "tau-retail", "fab"]
const FINISHED = new Set<BatchRun["status"]>(["completed", "stopped", "cancelled", "interrupted", "failed"])

const ARCH: Record<string, { label: string; what: string }> = {
  "single-agent": { label: "Single agent", what: "One model call answers the task on its own. The baseline every other architecture is measured against." },
  "prompt-chaining": { label: "Prompt chain", what: "Fixed steps in sequence; each model call works from the previous step's output." },
  routing: { label: "Routing", what: "A router reads the task and hands it to one specialist prompt." },
  parallelization: { label: "Parallel", what: "Several model calls work at once and their answers are merged." },
  "evaluator-optimizer": { label: "Evaluator", what: "One model drafts an answer, a second critiques it, and the draft is revised until the critic accepts it." },
  "autonomous-agent": { label: "Autonomous", what: "The model plans its own steps and calls tools until it decides it is done." },
  custom: { label: "Custom", what: "A hand-built graph of model calls." },
}
const arch = (id: string) => ARCH[id] ?? { label: id, what: "" }

const PASS_MEANS: Record<string, string> = {
  finqa: "the numeric answer matches the filing's figure",
  "tau2-retail": "the store database ends in the state the task expects and the customer's questions were answered",
  "tau-retail": "the store database ends in the state the task expects",
  fab: "the answer is accepted by the rubric",
}

/** 95% Wilson interval for k of n, as a [low, high] fraction. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0]
  const z = 1.96, p = k / n, d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

type Row = {
  batch: BatchRun
  /** answers graded: tasks × passes */
  graded: number
  expected: number
  /** tasks graded: the n the interval is built on, since a task's passes are not independent */
  n: number
  passes: number
  eligible: boolean
  rate: number
  low: number
  high: number
}

function toRow(b: BatchRun): Row {
  const passes = b.passes ?? 1
  const graded = b.summary.passed + b.summary.failed
  const expected = b.size * passes
  const n = Math.min(b.size, Math.ceil(graded / passes))
  const eligible = b.status === "completed" && graded === expected && b.size >= MIN_N
  const rate = graded ? b.summary.passed / graded : 0
  const [low, high] = wilson(rate * n, n)
  return { batch: b, graded, expected, n, passes, eligible, rate, low, high }
}

/** "69–85": the interval the rate sits in, which is not symmetric. */
function bounds(r: Row) {
  return `${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}`
}
/** "50 × 2" for a two-pass run, "20" for one pass. */
function nLabel(r: Row) {
  if (!r.eligible && r.graded < r.expected) return `${r.graded} of ${r.expected}`
  return r.passes > 1 ? `${r.n} × ${r.passes}` : String(r.n)
}
/** Whether two rows ran the same model, so a delta between them means something. */
const sameModel = (a: Row, b: Row) => a.batch.models.join() === b.batch.models.join()

/**
 * The row each configuration is judged by, per benchmark: its latest eligible run, or failing
 * that its latest finished run with anything graded, marked partial. Eligible rows rank first.
 */
function leaderboard(batches: BatchRun[]) {
  const byKey = new Map<string, Row>()
  const sorted = [...batches].sort((a, c) => c.created_at.localeCompare(a.created_at))
  for (const b of sorted) {
    if (!FINISHED.has(b.status)) continue
    const row = toRow(b)
    if (!row.graded) continue
    const key = `${b.configuration_id}::${b.benchmark_id}`
    const have = byKey.get(key)
    if (!have || (!have.eligible && row.eligible)) byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.rate - a.rate || b.graded - a.graded)
}

/** The list's columns, shared by the header and every row. */
const COLS = "grid w-full grid-cols-[minmax(0,1fr)_minmax(150px,38%)_56px] items-center gap-3 px-5 md:grid-cols-[minmax(170px,1fr)_minmax(200px,32%)_56px_76px_100px]"
const card = "rounded-[8px] border border-border bg-card"
const btnPrimary = "inline-flex h-9 shrink-0 items-center rounded-[8px] bg-foreground px-4 text-[12px] font-medium text-background hover:opacity-90"
const btnQuiet = "inline-flex h-9 shrink-0 items-center rounded-[8px] border border-border px-4 text-[12px] font-medium text-mm-dark hover:bg-muted/60"
const pill = "rounded-[8px] px-1.5 py-px text-[12px] leading-[16px] whitespace-nowrap"

export default function Dashboard() {
  const [batches, setBatches] = useState<BatchRun[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [datasets, setDatasets] = useState<BenchmarkInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [asOf, setAsOf] = useState<Date | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listBatches(undefined, 200), getHealth(), getDatasets().catch(() => ({ benchmarks: [] as BenchmarkInfo[] }))])
      .then(([b, h, d]) => {
        if (cancelled) return
        setBatches(b.batches)
        setHealth(h)
        setDatasets(d.benchmarks)
        setAsOf(new Date())
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  const board = useMemo(() => leaderboard(batches), [batches])
  const benches = useMemo(
    () =>
      [...new Set(board.map((r) => r.batch.benchmark_id))].sort(
        (a, b) => (BENCH_ORDER.indexOf(a) + 1 || 99) - (BENCH_ORDER.indexOf(b) + 1 || 99),
      ),
    [board],
  )
  const taskCount = useMemo(() => Object.fromEntries(datasets.map((d) => [d.id, d.task_count])), [datasets])
  const recent = useMemo(
    () => [...batches].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
    [batches],
  )
  const running = batches.filter((b) => b.status === "running" || b.status === "paused")
  const open = openId ? board.find((r) => r.batch.id === openId) ?? null : null

  return (
    <div className={cn("mx-auto w-full max-w-[1180px] transition-[padding] duration-200", openId && "xl:pr-[440px]")}>
      {/* 1 · Introduction */}
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 max-w-[76ch]">
          <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Agent Evaluation</h2>
          <p className="mt-1.5 text-[15px] leading-snug text-mm-dark">
            Does a multi-agent architecture beat a single agent on finance tasks, and at what price?
            {benches.length ? (
              <> Judged on {benches.map(benchmarkName).join(" and ")} by pass rate and cost per correct answer.</>
            ) : null}
          </p>
          <HowThisWorks benches={benches} />
          {error ? <p className="mt-1.5 text-[12px] text-[#b34800]">{error}</p> : null}
        </div>
        <Link href="/configurations" className={btnPrimary}>Run an evaluation</Link>
      </header>

      {/* 2 · Research snapshot: one card per benchmark */}
      {benches.length ? (
        <div className={cn("mt-6 grid gap-4", benches.length > 1 && "md:grid-cols-2")}>
          {benches.map((id) => (
            <Snapshot key={id} id={id} rows={board.filter((r) => r.batch.benchmark_id === id)} total={taskCount[id]} onOpen={setOpenId} />
          ))}
        </div>
      ) : null}

      {/* 3 · Configurations compared */}
      <section className={cn("mt-6", card)}>
        <h3 className="px-5 pt-4 pb-3 text-[15px] font-semibold text-mm-dark">Configurations compared</h3>
        {board.length ? (
          benches.map((id) => {
            const group = board.filter((r) => r.batch.benchmark_id === id)
            const best = group.find((r) => r.eligible)
            const baseline = group.find((r) => r.eligible && r.batch.architecture === "single-agent")
            return (
              <div key={id} className="border-t border-border">
                <div className={cn(COLS, "items-baseline border-l-2 border-transparent pt-3 pb-1 text-[12px] text-muted-foreground")}>
                  <span className="font-medium text-mm-dark">{benchmarkName(id)}</span>
                  <span>Pass rate · 95% interval</span>
                  <span className="text-right">n</span>
                  <span className="hidden text-right md:block">$ / correct</span>
                  <span className="hidden text-right md:block">Time p50–p95</span>
                </div>
                <ul>
                  {group.map((r) => (
                    <ConfigRow
                      key={r.batch.id}
                      row={r}
                      best={r === best}
                      baseline={r === baseline}
                      delta={baseline && r !== baseline && r.eligible && sameModel(r, baseline) && r.n === baseline.n ? r.rate - baseline.rate : null}
                      selected={openId === r.batch.id}
                      onOpen={() => setOpenId(r.batch.id)}
                    />
                  ))}
                </ul>
              </div>
            )
          })
        ) : (
          <p className="mx-5 mb-5 mt-1 rounded-[8px] border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
            {loaded ? "No end-to-end runs yet. Open a configuration and run it on FinQA or τ²-bench." : "Loading…"}
          </p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* 4 · Recent activity */}
        <section className={cn("min-w-0", card)}>
          <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
            <h3 className="text-[15px] font-semibold text-mm-dark">Recent activity</h3>
            {asOf ? <span className="text-[12px] text-muted-foreground">as of {when(asOf.toISOString())}</span> : null}
          </div>
          {recent.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {recent.map((b) => (
                <li key={b.id}>
                  <Link href={`/runs/e2e/${b.id}`} className="flex h-11 items-center gap-3 px-5 text-[12px] hover:bg-muted/60">
                    <span className="min-w-0 flex-1 truncate text-mm-dark">
                      {b.configuration_name}
                      <span className="text-muted-foreground"> · {benchmarkName(b.benchmark_id)}, {b.size}{(b.passes ?? 1) > 1 ? ` × ${b.passes}` : ""}</span>
                    </span>
                    <span className="font-data text-mm-dark">
                      {b.status === "running" || b.status === "paused" ? `${b.summary.done}/${b.summary.total}` : pct(b.summary.pass_rate, 1)}
                    </span>
                    <span className="w-[7rem] shrink-0 whitespace-nowrap text-right font-data text-muted-foreground">{when(b.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-4 text-[12px] text-muted-foreground">{loaded ? "No runs yet." : "Loading…"}</p>
          )}
          <div className="border-t border-border px-5 py-3">
            <Link href="/runs" className="text-[12px] font-medium text-mm-charge hover:underline">All runs</Link>
          </div>
        </section>

        {/* 5 · Research coverage */}
        <Coverage board={board} datasets={datasets} health={health} running={running} loaded={loaded} onOpen={setOpenId} />
      </div>

      <SidePanel row={open} baseline={open ? board.find((r) => r.eligible && r.batch.benchmark_id === open.batch.benchmark_id && r.batch.architecture === "single-agent") ?? null : null} onClose={() => setOpenId(null)} />
    </div>
  )
}

/** The definitions, in a popover under the lede. */
function HowThisWorks({ benches }: { benches: string[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown)
    }
  }, [open])
  return (
    <div ref={box} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[12px] font-medium text-mm-charge hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/40"
      >
        {open ? "Hide how this works" : "How this works"}
      </button>
      {open ? (
        <div className={cn("absolute left-0 top-7 z-20 max-h-[70vh] w-[min(92vw,520px)] overflow-y-auto p-5 shadow-lg", card)}>
          <dl className="space-y-3 text-[12px] leading-snug">
            {(benches.length ? benches : ["finqa", "tau2-retail"]).map((id) => (
              <div key={id}>
                <dt className="font-medium text-mm-dark">A pass on {benchmarkName(id)}</dt>
                <dd className="text-muted-foreground">{PASS_MEANS[id] ?? "the checker accepts the answer"}.</dd>
              </div>
            ))}
            <div>
              <dt className="font-medium text-mm-dark">Cost per correct answer</dt>
              <dd className="text-muted-foreground">Everything the run spent on model calls, divided by the answers it got right.</dd>
            </div>
            <div>
              <dt className="font-medium text-mm-dark">n and the interval</dt>
              <dd className="text-muted-foreground">How many tasks were graded (× passes, when a run repeats them), and the 95% interval the pass rate sits in; repeated passes of one task are not independent, so the interval is built on tasks. A run counts for the leaderboard only when it finished every task it was given, with at least {MIN_N} tasks; others are marked partial.</dd>
            </div>
            <div>
              <dt className="font-medium text-mm-dark">Architectures</dt>
              <dd className="text-muted-foreground">
                {Object.values(ARCH).filter((a) => a.what).map((a) => (
                  <span key={a.label} className="block"><span className="text-mm-dark">{a.label}</span>: {a.what}</span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  )
}

/** Best multi-agent against best single agent on one benchmark, with n and the interval. */
function Snapshot({ id, rows, total, onOpen }: { id: string; rows: Row[]; total?: number; onOpen: (id: string) => void }) {
  const eligible = rows.filter((r) => r.eligible)
  const singles = eligible.filter((r) => r.batch.architecture === "single-agent")
  const multis = eligible.filter((r) => r.batch.architecture !== "single-agent")
  const single = singles[0]
  // the best multi-agent run on the same model as the baseline, so the delta is like for like
  const multi = single ? multis.find((r) => sameModel(r, single)) ?? multis[0] : multis[0]
  const lead = eligible[0]
  const noun = taskNoun(id, 2)
  const ratio = multi && single && single.batch.summary.cost_per_pass_usd && multi.batch.summary.cost_per_pass_usd
    ? multi.batch.summary.cost_per_pass_usd / single.batch.summary.cost_per_pass_usd
    : null
  return (
    <section className={cn("p-5", card)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-mm-dark">{benchmarkName(id)}</h3>
        <span className="text-[12px] text-muted-foreground">
          {lead ? `${lead.n} of ${total?.toLocaleString() ?? "?"} ${noun}${lead.passes > 1 ? `, ${lead.passes} passes` : ""}` : `${rows.length} partial ${rows.length === 1 ? "run" : "runs"}`}
        </span>
      </div>
      {single && multi ? (
        <>
          <p className="mt-2 text-[15px] leading-snug text-mm-dark tabular-nums">
            {arch(multi.batch.architecture).label} <Rate r={multi} /> against the single agent&rsquo;s <Rate r={single} />
            {sameModel(multi, single) ? ", same model" : ", a different model"}: <Delta a={multi.rate} b={single.rate} /> at{" "}
            {usd(multi.batch.summary.cost_per_pass_usd)} vs {usd(single.batch.summary.cost_per_pass_usd)} per correct answer
            {ratio ? ratio >= 1 ? `, ${ratio.toFixed(1)}× the cost` : `, ${Math.round((1 - ratio) * 100)}% cheaper` : ""}.
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {overlap(multi, single) ? "The intervals overlap: not a settled difference at this n." : "The intervals do not overlap."}
            {multis.length > 1 ? ` Best of ${multis.length} multi-agent configurations, latest complete run of each.` : " Latest complete run of each."}
          </p>
        </>
      ) : lead ? (
        <p className="mt-2 text-[15px] leading-snug text-mm-dark tabular-nums">
          {lead.batch.configuration_name} ({arch(lead.batch.architecture).label}) <Rate r={lead} /> at{" "}
          {usd(lead.batch.summary.cost_per_pass_usd)} per correct answer. No {single ? "multi-agent" : "single-agent"} run to compare against yet.
        </p>
      ) : (
        <p className="mt-2 text-[15px] leading-snug text-mm-dark">No complete run of at least {MIN_N} {noun} yet.</p>
      )}
      {lead ? (
        <button type="button" onClick={() => onOpen((multi ?? lead).batch.id)} className="mt-3 text-[12px] font-medium text-mm-charge hover:underline">
          Numbers
        </button>
      ) : null}
    </section>
  )
}

const overlap = (a: Row, b: Row) => a.low <= b.high && b.low <= a.high

function Rate({ r }: { r: Row }) {
  return (
    <span className="whitespace-nowrap">
      {pct(r.rate, 1)} <span className="text-muted-foreground">({bounds(r)})</span>
    </span>
  )
}

function Delta({ a, b }: { a: number; b: number }) {
  const d = (a - b) * 100
  return <span className="whitespace-nowrap">{d > 0 ? "+" : ""}{d.toFixed(1)} points</span>
}

function ConfigRow({ row, best, baseline, delta, selected, onOpen }: { row: Row; best: boolean; baseline: boolean; delta: number | null; selected: boolean; onOpen: () => void }) {
  const b = row.batch, s = b.summary
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={selected}
        aria-label={`${b.configuration_name}, ${arch(b.architecture).label}: ${pct(row.rate, 1)} of ${nLabel(row)}, interval ${bounds(row)}${row.eligible ? "" : ", partial"}`}
        className={cn(
          COLS,
          "group border-l-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mm-charge/50",
          selected ? "border-mm-charge bg-muted/40" : "border-transparent",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span className={cn("line-clamp-2 text-[15px] font-medium leading-tight", row.eligible ? "text-mm-dark" : "text-muted-foreground")}>{b.configuration_name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
              <ArchBadge id={b.architecture} />
              {baseline ? <span className={cn(pill, "border border-border")}>baseline</span> : null}
              {!row.eligible ? <span className={cn(pill, "bg-muted")}>partial · {partialWhy(row)}</span> : null}
              <span className="truncate">{b.models.join(", ") || b.mode}</span>
            </span>
          </span>
          <CaretRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" weight="bold" />
        </span>
        <Bar row={row} best={best} delta={delta} />
        <span className="text-right font-data text-[12px] text-muted-foreground">{nLabel(row)}</span>
        <span className="hidden text-right font-data text-[12px] text-mm-dark md:block">{usd(s.cost_per_pass_usd)}</span>
        <span className="hidden text-right font-data text-[12px] text-mm-dark md:block">
          {secs(s.p50_latency_sec)}<span className="text-muted-foreground">–{secs(s.p95_latency_sec)}</span>
        </span>
      </button>
    </li>
  )
}

function partialWhy(row: Row) {
  const b = row.batch
  if (b.status !== "completed") return b.status
  if (row.graded < row.expected) return `${b.summary.errors ? `${b.summary.errors} errored, ` : ""}${row.graded} of ${row.expected} graded`
  return `under ${MIN_N} tasks`
}

/** The pass rate as a bar, its 95% interval drawn as a bracket across it and printed beside it. */
function Bar({ row, best, delta }: { row: Row; best: boolean; delta: number | null }) {
  const title = `${pct(row.rate, 1)} of ${nLabel(row)}, 95% interval ${bounds(row)}${delta != null ? `; ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} points against the baseline` : ""}`
  return (
    <span className="flex items-center gap-3" title={title}>
      <span className="relative h-[12px] flex-1 overflow-hidden rounded-r-[2px] bg-muted">
        <span
          className={cn("block h-full rounded-r-[2px]", best ? "bg-mm-charge" : row.eligible ? "bg-muted-foreground/45" : "bg-muted-foreground/20")}
          style={{ width: `${Math.max(1, row.rate * 100)}%` }}
        />
        <span
          className="absolute top-[3px] h-[6px] border-x-2 border-foreground/80 bg-foreground/15"
          style={{ left: `${row.low * 100}%`, width: `${Math.max(0, (row.high - row.low) * 100)}%` }}
        />
      </span>
      <span className={cn("w-[5.5rem] text-right font-data text-[12px] leading-tight", row.eligible ? "text-mm-dark" : "text-muted-foreground")}>
        {pct(row.rate, 1)}
        <span className="block text-muted-foreground">{bounds(row)}</span>
      </span>
    </span>
  )
}

function ArchBadge({ id }: { id: string }) {
  const a = arch(id)
  if (!a.what) return <span>{a.label}</span>
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2" />}>{a.label}</TooltipTrigger>
      <TooltipContent className="max-w-[32ch] text-[12px] leading-snug">{a.what}</TooltipContent>
    </Tooltip>
  )
}

/** Configurations × benchmarks: the latest eligible pass rate with n, or that it has not run. */
function Coverage({ board, datasets, health, running, loaded, onOpen }: { board: Row[]; datasets: BenchmarkInfo[]; health: Health | null; running: BatchRun[]; loaded: boolean; onOpen: (id: string) => void }) {
  const benches = (datasets.length ? datasets.map((d) => d.id) : [...new Set(board.map((r) => r.batch.benchmark_id))]).sort(
    (a, b) => (BENCH_ORDER.indexOf(a) + 1 || 99) - (BENCH_ORDER.indexOf(b) + 1 || 99),
  )
  const configs = [...new Map(board.map((r) => [r.batch.configuration_id, r.batch.configuration_name])).entries()]
  const cell = (cid: string, bid: string) => board.find((r) => r.batch.configuration_id === cid && r.batch.benchmark_id === bid)
  return (
    <section className={cn("min-w-0", card)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 pt-4 pb-2">
        <h3 className="text-[15px] font-semibold text-mm-dark">Research coverage</h3>
        <span className="text-[12px] text-muted-foreground">
          {running.length ? `${running.length} ${running.length === 1 ? "batch" : "batches"} running · ` : ""}
          {health?.spend ? `${usd(health.spend.remaining_budget_usd)} of today's ${usd(health.spend.daily_budget_usd)} budget left` : loaded ? "budget unknown" : "…"}
        </span>
      </div>
      {configs.length ? (
        <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-normal">Configuration</th>
              {benches.map((id) => {
                const d = datasets.find((x) => x.id === id)
                const ran = Math.max(0, ...board.filter((r) => r.eligible && r.batch.benchmark_id === id).map((r) => r.n))
                return (
                  <th key={id} className="px-3 py-2 text-right font-normal">
                    {benchmarkName(id)}
                    <span className="block font-data">{d ? `${ran} of ${d.task_count.toLocaleString()}` : ""}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {configs.map(([cid, name]) => (
              <tr key={cid} className="border-t border-border">
                <td className="px-5 py-2 text-mm-dark">{name}</td>
                {benches.map((bid) => {
                  const r = cell(cid, bid)
                  const scored = datasets.find((x) => x.id === bid)?.scored ?? true
                  return (
                    <td key={bid} className="px-3 py-2 text-right font-data">
                      {r ? (
                        <button type="button" onClick={() => onOpen(r.batch.id)} className={cn("hover:underline", r.eligible ? "text-mm-dark" : "text-muted-foreground")}>
                          {pct(r.rate, 1)} <span className="text-muted-foreground">· {nLabel(r)}{r.eligible ? "" : " partial"}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground/70">{scored ? "not run" : "not auto-scored"}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <p className="px-5 pb-4 text-[12px] text-muted-foreground">{loaded ? "Nothing has run yet." : "Loading…"}</p>
      )}
    </section>
  )
}

/** Everything about one configuration's run, in a panel that stays while other rows are clicked. */
function SidePanel({ row, baseline, onClose }: { row: Row | null; baseline: Row | null; onClose: () => void }) {
  const [full, setFull] = useState<BatchRun | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const reduce = useReducedMotion()
  const id = row?.batch.id
  useEffect(() => {
    setFull(null)
    if (!id) return
    // remember what opened the panel (a row, a link, a cell), so closing puts focus back on it
    const active = document.activeElement as HTMLElement | null
    if (active && active !== heading.current && !heading.current?.parentElement?.parentElement?.contains(active)) opener.current = active
    let cancelled = false
    getBatch(id).then((b) => !cancelled && setFull(b)).catch(() => undefined)
    heading.current?.focus()
    return () => {
      cancelled = true
    }
  }, [id])
  useEffect(() => {
    if (id) return
    if (opener.current && document.body.contains(opener.current)) opener.current.focus()
    opener.current = null
  }, [id])
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [id, onClose])

  const b = row?.batch, s = b?.summary
  const passes = b?.passes ?? 1
  return (
    <AnimatePresence>
      {row && b && s ? (
        <motion.aside
          key="panel"
          initial={reduce ? false : { x: 440 }}
          animate={{ x: 0 }}
          exit={{ x: 440 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          aria-labelledby="overview-panel-title"
          role="complementary" className="fixed inset-y-0 right-0 z-40 flex w-[min(100vw,380px)] flex-col xl:w-[440px] overflow-y-auto border-l border-border bg-card shadow-[-8px_0_24px_rgba(0,23,53,0.08)]"
        >
          <div className="flex items-start justify-between gap-3 px-6 pt-5">
            <div className="min-w-0">
              <h3 ref={heading} id="overview-panel-title" tabIndex={-1} className="truncate text-[15px] font-semibold text-mm-dark outline-none">{b.configuration_name}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {arch(b.architecture).label} · {b.models.join(", ") || b.mode} · {benchmarkName(b.benchmark_id)}, {b.size} {taskNoun(b.benchmark_id, b.size)}
                {passes > 1 ? ` × ${passes} passes` : ""} · {when(b.created_at)}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-[8px] p-1 text-muted-foreground hover:bg-muted hover:text-mm-dark">
              <X className="size-4" weight="bold" />
            </button>
          </div>

          <div className="px-6 pt-5">
            <p className="font-data text-[24px] leading-none text-mm-dark">
              {pct(row.rate, 1)} <span className="text-[15px] text-muted-foreground">({bounds(row)})</span>
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {s.passed} of {row.graded} {passes > 1 ? `answers (${row.n} ${taskNoun(b.benchmark_id, row.n)} × ${passes} passes)` : taskNoun(b.benchmark_id, row.graded)} passed; 95% interval on {row.n} {taskNoun(b.benchmark_id, row.n)}
              {baseline && baseline !== row && row.eligible && sameModel(row, baseline) && row.n === baseline.n ? <>, <Delta a={row.rate} b={baseline.rate} /> against the single-agent baseline</> : baseline === row ? ", the single-agent baseline" : baseline && baseline !== row && row.eligible ? (sameModel(row, baseline) ? ", a different task sample from the baseline, so no delta" : ", no same-model baseline to compare against") : ""}
              {!row.eligible ? ` · partial: ${partialWhy(row)}, not ranked` : ""}
            </p>
          </div>

          <div className="px-6 pt-5">
            <p className="mb-1.5 text-[12px] text-muted-foreground">Outcome per {taskNoun(b.benchmark_id, 1)}, in run order</p>
            {full?.items.length ? (
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
            ) : (
              <div className="h-[10px] w-40 animate-pulse rounded-[2px] bg-muted" />
            )}
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {s.passed} passed · {s.failed} failed{s.errors ? ` · ${s.errors} errored` : ""}
            </p>
          </div>

          {passes > 1 && s.pass_all_rate != null && s.pass_any_rate != null ? (
            <Consistency always={s.pass_all_rate} any={s.pass_any_rate} passes={passes} />
          ) : null}

          <dl className="mx-6 mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-[12px]">
            {(
              [
                ["Cost per correct answer", usd(s.cost_per_pass_usd)],
                ["Total cost", `${usd(s.cost_usd)} of a ${usd(b.budget_usd)} cap`],
                ["Time per task", `${secs(s.p50_latency_sec)} median, ${secs(s.p95_latency_sec)} at the 95th`],
                ["Tokens in / out", `${s.prompt_tokens.toLocaleString()} / ${s.completion_tokens.toLocaleString()}`],
                ["Errors", String(s.errors)],
                ["Status", `${row.eligible ? "complete" : `partial (${partialWhy(row)})`}${b.stop_reason ? `: ${b.stop_reason}` : ""}`],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 font-data text-mm-dark">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-auto flex flex-wrap gap-2 border-t border-border px-6 py-5 pt-5">
            <Link href={`/runs/e2e/${b.id}`} className={btnPrimary}>Open the full run</Link>
            <Link href={`/configurations/${b.configuration_id}`} className={btnQuiet}>Open the configuration</Link>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

/** Three segments: right in every pass, flipped between passes, wrong in every pass. */
function Consistency({ always, any, passes }: { always: number; any: number; passes: number }) {
  const flipped = Math.max(0, any - always), never = Math.max(0, 1 - any)
  const reduce = useReducedMotion()
  const seg = (w: number, cls: string, label: string) => (
    <motion.span
      key={label}
      className={cn("h-full", cls)}
      initial={reduce ? false : { width: 0 }}
      animate={{ width: `${w * 100}%` }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      title={`${label}: ${pct(w, 1)}`}
    />
  )
  return (
    <div className="px-6 pt-5">
      <p className="mb-1.5 text-[12px] text-muted-foreground" title="A task flipped if it passed in at least one pass but not in all of them">Consistency over {passes} passes</p>
      <div className="flex h-[12px] w-full overflow-hidden rounded-[2px] bg-muted">
        {seg(always, "bg-mm-green", "Right every pass")}
        {seg(flipped, "bg-mm-yellow", "Flipped between passes")}
        {seg(never, "bg-mm-orange", "Wrong every pass")}
      </div>
      <p className="mt-1.5 font-data text-[12px] text-muted-foreground">
        {pct(always, 1)} right every pass · {pct(flipped, 1)} flipped · {pct(never, 1)} wrong every pass
      </p>
    </div>
  )
}
