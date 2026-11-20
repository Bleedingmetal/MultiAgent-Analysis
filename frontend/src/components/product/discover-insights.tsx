"use client"

/*
 * Discover insights. One open question, a handful of answers to pick from. Each
 * question is answered from the same leaderboard rows the rest of the Overview uses (the
 * latest complete run of each configuration per benchmark), so nothing here is computed from
 * anything the page does not already show. Partial runs never take part in a ranking.
 *
 * Clicking a configuration anywhere in a chart calls `onOpen`, which opens the Overview's
 * existing side panel; this component has no panel of its own.
 *
 * To add a question: add an entry to QUESTIONS and a case to `answer`. To add a benchmark
 * nothing is needed: tabs come from the benchmarks that have rows.
 */

import Link from "next/link"
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, CaretRight } from "@phosphor-icons/react"

import { pct, secs, usd } from "@/components/product/batch-results"
import { type RepeatabilityGroup, benchmarkName, getRepeatability } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Row } from "@/views/dashboard"

type QuestionId = "best" | "cost" | "speed" | "consistent" | "multi"

const QUESTIONS: { id: QuestionId; label: string; hint: string }[] = [
  { id: "best", label: "Which architecture performs best?", hint: "Pass rate, with its 95% range" },
  { id: "cost", label: "Which is most cost-efficient?", hint: "Cost per correct answer against accuracy" },
  { id: "speed", label: "Which is fastest?", hint: "Median and 95th-percentile time per task" },
  { id: "consistent", label: "How reliable and consistent are they?", hint: "pass^k and consistency over every repeat of a task" },
  { id: "multi", label: "Do multi-agent systems beat a single agent?", hint: "Points gained or lost against the baseline" },
]

const EASE = [0.2, 0, 0, 1] as const
const isSingle = (r: Row) => r.batch.architecture === "single-agent"
const sameModel = (a: Row, b: Row) => a.batch.models.join() === b.batch.models.join()
const overlap = (a: Row, b: Row) => a.low <= b.high && b.low <= a.high
const interval = (r: Row) => `${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}`

type Answer = {
  /** the one number the question comes down to */
  metric: { value: number; format: (v: number) => string; label: string }
  headline: ReactNode
  note?: ReactNode
  chart: ReactNode
}

type Ctx = { rows: Row[]; selectedId: string | null; onOpen: (id: string) => void; archLabel: (id: string) => string; reduce: boolean }

export function DiscoverInsights({
  board,
  benches,
  selectedId,
  onOpen,
  archLabel,
}: {
  board: Row[]
  benches: string[]
  selectedId: string | null
  onOpen: (id: string) => void
  archLabel: (architecture: string) => string
}) {
  const reduce = useReducedMotion() ?? false
  const [question, setQuestion] = useState<QuestionId>("best")
  const [chosen, setChosen] = useState<string | null>(null)
  const bench = chosen && benches.includes(chosen) ? chosen : benches[0]

  const all = useMemo(() => board.filter((r) => r.batch.benchmark_id === bench), [board, bench])
  const rows = useMemo(() => all.filter((r) => r.eligible), [all])
  const partial = all.length - rows.length

  const ctx: Ctx = { rows, selectedId, onOpen, archLabel, reduce }
  const answer = useMemo(() => answerFor(question, ctx), [question, rows, selectedId, archLabel, reduce]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = QUESTIONS.find((x) => x.id === question)!

  return (
    <section className="mt-4 overflow-hidden rounded-[16px] bg-card">
      <div className="relative px-6 pt-5 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h3 className="min-w-0 text-[15px] font-semibold text-mm-dark">Discover insights</h3>
          {benches.length > 1 ? (
            <div role="tablist" aria-label="Benchmark" className="relative flex shrink-0 gap-0.5 rounded-full bg-muted p-0.5">
              {benches.map((id) => {
                const on = id === bench
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={on}
                    type="button"
                    onClick={() => setChosen(id)}
                    className={cn(
                      "relative rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/50",
                      on ? "text-mm-dark" : "text-muted-foreground hover:text-mm-dark",
                    )}
                  >
                    {on ? (
                      <motion.span
                        layoutId="explore-bench"
                        className="absolute inset-0 rounded-full bg-card shadow-[0_1px_2px_rgba(0,23,53,0.12)]"
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
                      />
                    ) : null}
                    <span className="relative">{benchmarkName(id)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">{benchmarkName(bench)}</span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <ul className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-0.5 lg:py-3 lg:pl-3 lg:pr-0" aria-label="Questions">
          {QUESTIONS.map((x) => {
            const on = x.id === question
            return (
              <li key={x.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setQuestion(x.id)}
                  className={cn(
                    "group relative flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/50",
                    !on && "hover:bg-muted/60",
                  )}
                >
                  {on ? (
                    <motion.span
                      layoutId="explore-question"
                      className="absolute inset-0 rounded-[10px] bg-muted"
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  <span className="relative min-w-0 flex-1">
                    <span className={cn("block text-[13px] leading-snug", on ? "font-medium text-mm-dark" : "text-mm-dark")}>{x.label}</span>
                  </span>
                  <CaretRight
                    weight="bold"
                    className={cn("relative size-3 shrink-0 transition-all", on ? "translate-x-0 text-mm-charge opacity-100" : "-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100")}
                  />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="min-w-0 px-6 pt-4 pb-5 lg:pl-8" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${bench}:${question}`}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              {question === "consistent" ? (
                <Repeatability bench={bench} reduce={reduce} />
              ) : answer ? (
                <>
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                    <div className="shrink-0">
                      <p className="font-data text-[34px] leading-none tracking-[-0.02em] text-mm-dark">
                        <CountUp value={answer.metric.value} format={answer.metric.format} reduce={reduce} />
                      </p>
                      <p className="mt-1.5 max-w-[26ch] text-[12px] text-muted-foreground">{answer.metric.label}</p>
                    </div>
                    <p className="min-w-[24ch] flex-1 text-[15px] leading-snug text-mm-dark">{answer.headline}</p>
                  </div>
                  <div className="mt-5">{answer.chart}</div>
                  {answer.note ? <p className="mt-3 text-[12px] leading-snug text-muted-foreground">{answer.note}</p> : null}
                </>
              ) : (
                <Empty q={q.label} id={question} bench={bench} none={rows.length === 0} />
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[12px] text-muted-foreground">
            <span>
              {answer ? "Select a configuration to open its run. " : ""}
              {q.hint}
              {partial ? ` · ${partial} partial ${partial === 1 ? "run" : "runs"} left out` : ""}
            </span>
            <Link href={`/compare?benchmark=${encodeURIComponent(bench)}`} className="group inline-flex items-center gap-1 font-medium text-mm-charge hover:underline">
              Full {benchmarkName(bench)} comparison
              <ArrowRight weight="bold" className="size-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

const NEEDS: Record<QuestionId, string> = {
  best: "at least one complete run",
  cost: "at least one complete run with a cost",
  speed: "at least one complete run with timings",
  consistent: "a complete run that repeats each task (2 or more passes)",
  multi: "a complete single-agent run and a complete multi-agent run",
}

function Empty({ q, id, bench, none }: { q: string; id: QuestionId; bench: string; none: boolean }) {
  return (
    <div className="rounded-[16px] border border-dashed border-border px-4 py-10 text-center">
      <p className="text-[15px] text-mm-dark">{q}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-[12px] text-muted-foreground">
        {none ? `No complete ${benchmarkName(bench)} runs yet. ` : "Not answerable from the runs so far. "}
        This answers itself once {benchmarkName(bench)} has {NEEDS[id]}.
      </p>
      {none ? (
        <Link href="/configurations" className="mt-3 inline-block text-[12px] font-medium text-mm-charge hover:underline">
          Run an evaluation
        </Link>
      ) : null}
    </div>
  )
}

/** A number that counts from its last value to the new one. */
function CountUp({ value, format, reduce }: { value: number; format: (v: number) => string; reduce: boolean }) {
  const el = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  const fmt = useRef(format)
  fmt.current = format
  useEffect(() => {
    const set = (v: number) => {
      if (el.current) el.current.textContent = fmt.current(v)
    }
    if (reduce) {
      set(value)
      from.current = value
      return
    }
    const c = animate(from.current, value, { duration: 0.6, ease: "easeOut", onUpdate: set })
    from.current = value
    return () => c.stop()
  }, [value, reduce])
  return <span ref={el} />
}

/* ----------------------------------------------------------------------------------------- */

function answerFor(id: QuestionId, c: Ctx): Answer | null {
  const { rows, archLabel } = c
  // FAB is rubric-graded: its headline is partial credit, not a pass rate
  const rateWord = rows[0]?.batch.summary.mean_score != null ? "partial credit" : "pass rate"
  const name = (r: Row) => r.batch.configuration_name
  const label = (r: Row) => `${name(r)} (${archLabel(r.batch.architecture)})`

  switch (id) {
    case "best": {
      const sorted = [...rows].sort((a, b) => b.rate - a.rate)
      const [top, next] = sorted
      if (!top) return null
      return {
        metric: { value: top.rate, format: (v) => pct(v, 1), label: `${rateWord}, ${name(top)}` },
        headline: next ? (
          <>
            {label(top)} leads. {label(next)} is next at {pct(next.rate, 1)}; {overlap(top, next) ? "their intervals overlap, so the order is not settled at this n." : "their intervals do not overlap."}
          </>
        ) : (
          <>{label(top)} is the only configuration with a complete run so far.</>
        ),
        note: `Bars are the ${rateWord}; the range beside each is its 95% interval, built on tasks.`,
        chart: (
          <BarList
            c={c}
            bars={sorted.map((r, i) => ({
              row: r,
              lead: i === 0,
              frac: r.rate,
              range: [r.low, r.high],
              value: pct(r.rate, 1),
              sub: interval(r),
            }))}
          />
        ),
      }
    }

    case "cost": {
      const priced = rows.filter((r) => r.batch.summary.cost_per_pass_usd)
      const cost = (r: Row) => r.batch.summary.cost_per_pass_usd as number
      const cheapest = [...priced].sort((a, b) => cost(a) - cost(b))[0]
      if (!cheapest) return null
      const frontier = paretoFrontier(priced)
      const dominant = frontier.length === 1 && frontier[0] === cheapest
      return {
        metric: { value: cost(cheapest), format: (v) => usd(v), label: `per correct answer, ${name(cheapest)}` },
        headline: (
          <>
            {label(cheapest)} is the cheapest per correct answer, at {pct(cheapest.rate, 1)} {rateWord}.{" "}
            {dominant ? "No other configuration is both more accurate and cheaper." : "The dashed line joins configurations that no other beats on both cost and accuracy."}
          </>
        ),
        note: "Cost is everything the run spent on model calls, divided by the answers it got right.",
        chart: <Scatter c={c} rows={priced} frontier={frontier} cost={cost} cheapest={cheapest} />,
      }
    }

    case "speed": {
      const timed = rows.filter((r) => r.batch.summary.p50_latency_sec != null)
      const p50 = (r: Row) => r.batch.summary.p50_latency_sec as number
      const p95 = (r: Row) => (r.batch.summary.p95_latency_sec ?? p50(r)) as number
      const sorted = [...timed].sort((a, b) => p50(a) - p50(b))
      const [fast, slow] = [sorted[0], sorted[sorted.length - 1]]
      if (!fast) return null
      const max = Math.max(...sorted.map(p95)) || 1
      return {
        metric: { value: p50(fast), format: (v) => secs(v), label: `median time per task, ${name(fast)}` },
        headline:
          fast === slow ? (
            <>{label(fast)} is the only timed configuration so far.</>
          ) : (
            <>
              {label(fast)} is fastest at a median of {secs(p50(fast))}; {label(slow)} takes {secs(p50(slow))}
              {p50(fast) > 0 && p50(slow) / p50(fast) >= 1.15 ? `, ${(p50(slow) / p50(fast)).toFixed(1)}× as long` : ""}.
            </>
          ),
        note: "The solid bar is the median task; the pale extension runs to the 95th percentile, the slow tail.",
        chart: (
          <BarList
            c={c}
            bars={sorted.map((r, i) => ({
              row: r,
              lead: i === 0,
              frac: p50(r) / max,
              ext: p95(r) / max,
              value: secs(p50(r)),
              sub: `to ${secs(p95(r))}`,
            }))}
          />
        ),
      }
    }

    case "consistent":
      return null // shown by <Repeatability>, which reads every repeat from the backend

    case "multi": {
      const single = rows.filter(isSingle).sort((a, b) => b.rate - a.rate)[0]
      const multis = rows.filter((r) => !isSingle(r)).sort((a, b) => b.rate - a.rate)
      if (!single || !multis.length) return null
      const best = multis.find((r) => sameModel(r, single)) ?? multis[0]
      const d = (best.rate - single.rate) * 100
      const span = Math.max(5, ...multis.map((r) => Math.abs(r.rate - single.rate) * 100)) * 1.15
      return {
        metric: { value: d, format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`, label: `${name(best)} against the single agent` },
        headline: (
          <>
            The best multi-agent configuration, {label(best)}, {d > 0 ? "beats" : d < 0 ? "trails" : "ties"} the single agent&rsquo;s {pct(single.rate, 1)}
            {sameModel(best, single) ? ", on the same model" : ", but on a different model"}.{" "}
            {overlap(best, single) ? "The intervals overlap, so this is not a settled difference at this n." : "The intervals do not overlap."}
          </>
        ),
        note: `Bars show each multi-agent configuration's ${rateWord} minus the single agent's. Pale bars ran a different model, so the gap mixes two effects.`,
        chart: <Diverging c={c} single={single} multis={multis} span={span} />,
      }
    }
  }
}

/** Configurations that no other beats on both cost (lower) and pass rate (higher), cheapest first. */
function paretoFrontier(rows: Row[]) {
  const cost = (r: Row) => r.batch.summary.cost_per_pass_usd as number
  const out: Row[] = []
  let bestRate = -1
  for (const r of [...rows].sort((a, b) => cost(a) - cost(b) || b.rate - a.rate)) {
    if (r.rate > bestRate) {
      out.push(r)
      bestRate = r.rate
    }
  }
  return out
}

/* ----------------------------------------------------------------------------------------- */

type Bar = {
  row: Row
  lead?: boolean
  frac?: number
  ext?: number
  range?: [number, number]
  segments?: { w: number; cls: string; t: string }[]
  value: string
  sub?: string
}

const rowGrid = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_64px] items-center gap-3 md:grid-cols-[minmax(120px,0.8fr)_minmax(0,2fr)_72px]"

function BarList({ c, bars, footer }: { c: Ctx; bars: Bar[]; footer?: ReactNode }) {
  return (
    <div>
      <ul className="space-y-0.5">
        <AnimatePresence initial={false} mode="popLayout">
          {bars.map((b, i) => {
            const r = b.row
            const on = c.selectedId === r.batch.id
            return (
              <motion.li
                key={r.batch.id}
                layout={!c.reduce}
                initial={c.reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE, delay: c.reduce ? 0 : i * 0.04 }}
              >
                <button
                  type="button"
                  onClick={() => c.onOpen(r.batch.id)}
                  aria-pressed={on}
                  aria-label={`${r.batch.configuration_name}: ${b.value}${b.sub ? `, ${b.sub}` : ""}. Open its run.`}
                  className={cn(
                    "group w-full rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/50",
                    rowGrid,
                    on && "bg-muted/50",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-mm-dark">{r.batch.configuration_name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{c.archLabel(r.batch.architecture)}</span>
                  </span>
                  <span className="relative flex h-[14px] overflow-hidden rounded-r-[3px] bg-muted">
                    {b.segments ? (
                      b.segments.map((s) => (
                        <motion.span
                          key={s.t}
                          title={`${s.t}: ${pct(s.w, 1)}`}
                          className={cn("h-full transition-[filter] group-hover:brightness-110", s.cls)}
                          initial={c.reduce ? false : { width: 0 }}
                          animate={{ width: `${s.w * 100}%` }}
                          transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
                        />
                      ))
                    ) : (
                      <>
                        {b.ext != null ? (
                          <motion.span
                            className="absolute inset-y-0 left-0 bg-mm-charge/15"
                            initial={c.reduce ? false : { width: 0 }}
                            animate={{ width: `${b.ext * 100}%` }}
                            transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
                          />
                        ) : null}
                        <motion.span
                          className={cn("relative h-full rounded-r-[3px] transition-colors", b.lead || on ? "bg-mm-charge" : "bg-muted-foreground/45 group-hover:bg-mm-charge/70")}
                          initial={c.reduce ? false : { width: 0 }}
                          animate={{ width: `${Math.max(1, (b.frac ?? 0) * 100)}%` }}
                          transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
                        />
                      </>
                    )}
                  </span>
                  <span className="text-right font-data text-[12px] leading-tight text-mm-dark">
                    {b.value}
                    {b.sub ? <span className="block text-muted-foreground">{b.sub}</span> : null}
                  </span>
                </button>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      {footer}
    </div>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-[12px] text-muted-foreground">
      {items.map(([cls, t]) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-[2px]", cls)} />
          {t}
        </span>
      ))}
    </p>
  )
}

/** Cost per correct answer (x) against pass rate (y); the points are buttons. */
function Scatter({ c, rows, frontier, cost, cheapest }: { c: Ctx; rows: Row[]; frontier: Row[]; cost: (r: Row) => number; cheapest: Row }) {
  const [hover, setHover] = useState<string | null>(null)
  const xMax = Math.max(...rows.map(cost)) * 1.15 || 1
  const lo = Math.min(...rows.map((r) => r.rate)), hi = Math.max(...rows.map((r) => r.rate))
  const yMin = Math.max(0, Math.floor((lo - 0.05) * 10) / 10)
  const yMax = Math.min(1, Math.max(yMin + 0.1, Math.ceil((hi + 0.05) * 10) / 10))
  const x = (r: Row) => (cost(r) / xMax) * 100
  const y = (r: Row) => (1 - (r.rate - yMin) / (yMax - yMin)) * 100
  const ticks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3)
  return (
    <div className="relative h-[240px] w-full pb-0 pl-11 pr-4 pt-2">
      <div className="relative h-[calc(100%-28px)] w-full">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${(1 - (t - yMin) / (yMax - yMin)) * 100}%` }}>
            <span className="absolute -left-11 -translate-y-1/2 w-9 text-right font-data text-[11px] text-muted-foreground">{pct(t, 0)}</span>
          </div>
        ))}
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {frontier.length > 1 ? (
            <motion.polyline
              key={frontier.map((r) => r.batch.id).join()}
              points={frontier.map((r) => `${x(r)},${y(r)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              className="text-mm-charge/50"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              initial={c.reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
            />
          ) : null}
        </svg>
        {rows.map((r) => {
          const on = c.selectedId === r.batch.id
          const lead = r === cheapest
          const flip = x(r) > 62
          return (
            <motion.button
              key={r.batch.id}
              type="button"
              onClick={() => c.onOpen(r.batch.id)}
              onMouseEnter={() => setHover(r.batch.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.batch.id)}
              onBlur={() => setHover(null)}
              aria-pressed={on}
              aria-label={`${r.batch.configuration_name}: ${pct(r.rate, 1)} at ${usd(cost(r))} per correct answer. Open its run.`}
              className="group absolute -ml-[9px] -mt-[9px] grid size-[18px] place-items-center rounded-full focus-visible:outline-none"
              initial={c.reduce ? false : { left: "0%", top: "100%", opacity: 0, scale: 0.4 }}
              animate={{ left: `${x(r)}%`, top: `${y(r)}%`, opacity: 1, scale: 1, zIndex: hover === r.batch.id ? 20 : 1 }}
              whileHover={c.reduce ? undefined : { scale: 1.25 }}
              whileTap={c.reduce ? undefined : { scale: 0.92 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            >
              <span
                className={cn(
                  "size-3 rounded-full ring-2 ring-card transition-all group-focus-visible:ring-mm-charge",
                  lead || on ? "bg-mm-charge" : isSingle(r) ? "bg-foreground" : "bg-muted-foreground/60 group-hover:bg-mm-charge/80",
                  on && "outline outline-2 outline-offset-2 outline-mm-charge/40",
                )}
              />
              <AnimatePresence>
                {hover === r.batch.id ? (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className={cn(
                      "pointer-events-none absolute bottom-[calc(100%+4px)] z-30 w-max max-w-[220px] rounded-[10px] bg-card px-2.5 py-1.5 text-left shadow-[0_8px_24px_-8px_rgba(0,23,53,0.25)]",
                      flip ? "right-0" : "left-0",
                    )}
                  >
                    <span className="block truncate text-[12px] font-medium text-mm-dark">{r.batch.configuration_name}</span>
                    <span className="block font-data text-[12px] text-muted-foreground">
                      {pct(r.rate, 1)} · {usd(cost(r))}/correct
                    </span>
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between pl-11 pr-4 text-[11px] text-muted-foreground">
        <span>cheaper</span>
        <span>$ per correct answer →  ({usd(0)} to {usd(xMax)})</span>
      </div>
      <p className="absolute left-0 top-0 text-[11px] text-muted-foreground">Pass rate ↑</p>
    </div>
  )
}

/** Multi-agent pass rate minus the single agent's, as bars either side of a zero line. */
function Diverging({ c, single, multis, span }: { c: Ctx; single: Row; multis: Row[]; span: number }) {
  return (
    <div>
      <ul className="space-y-0.5">
        {multis.map((r, i) => {
          const d = (r.rate - single.rate) * 100
          const same = sameModel(r, single)
          const on = c.selectedId === r.batch.id
          const w = (Math.abs(d) / span) * 50
          return (
            <motion.li key={r.batch.id} layout={!c.reduce} initial={c.reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease: EASE, delay: c.reduce ? 0 : i * 0.04 }}>
              <button
                type="button"
                onClick={() => c.onOpen(r.batch.id)}
                aria-pressed={on}
                aria-label={`${r.batch.configuration_name}: ${d > 0 ? "+" : ""}${d.toFixed(1)} points against the single agent${same ? "" : ", different model"}. Open its run.`}
                className={cn("group w-full rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/50", rowGrid, on && "bg-muted/50")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-mm-dark">{r.batch.configuration_name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {c.archLabel(r.batch.architecture)}
                    {same ? "" : " · other model"}
                  </span>
                </span>
                <span className="relative h-[14px] rounded-[3px] bg-muted/60">
                  <span className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/50" />
                  <motion.span
                    className={cn("absolute inset-y-0 transition-opacity", d >= 0 ? "bg-mm-charge" : "bg-mm-orange", !same && "opacity-40 group-hover:opacity-60", same && "group-hover:opacity-85")}
                    style={d >= 0 ? { left: "50%" } : { right: "50%" }}
                    initial={c.reduce ? false : { width: 0 }}
                    animate={{ width: `${Math.max(0.5, w)}%` }}
                    transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
                  />
                </span>
                <span className="text-right font-data text-[12px] leading-tight text-mm-dark">
                  {d > 0 ? "+" : ""}
                  {d.toFixed(1)}
                  <span className="block text-muted-foreground">{pct(r.rate, 1)}</span>
                </span>
              </button>
            </motion.li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={() => c.onOpen(single.batch.id)}
        className="mt-1 ml-2 rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-mm-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/50"
      >
        Zero line: {single.batch.configuration_name}, single agent at {pct(single.rate, 1)} ({interval(single)})
      </button>
    </div>
  )
}

const KS = [2, 3, 5]

/**
 * Reliability (pass^k: every one of k attempts succeeds) and consistency (do repeats give
 * the same answer and take the same path), per configuration, over every stored repeat.
 */
function Repeatability({ bench, reduce }: { bench: string; reduce: boolean }) {
  const [k, setK] = useState(3)
  const [groups, setGroups] = useState<RepeatabilityGroup[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setGroups(null)
    setError(false)
    getRepeatability(bench, k)
      .then((res) => !cancelled && setGroups(res.groups))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [bench, k])

  // Most evidence first; a configuration leads only with enough tasks behind its number
  const shown = (groups ?? [])
    .filter((g) => g.reliability.value != null || g.consistency.output != null)
    .sort((a, b) => b.reliability.eligible_tasks - a.reliability.eligible_tasks || b.consistency.tasks - a.consistency.tasks)
  const hidden = (groups ?? []).length - shown.length
  const MIN_TASKS = 10
  const scored = shown.filter((g) => g.reliability.value != null)
  const lead =
    [...scored.filter((g) => g.reliability.eligible_tasks >= MIN_TASKS)].sort(
      (a, b) => (b.reliability.value ?? 0) - (a.reliability.value ?? 0),
    )[0] ?? scored[0]
  const fmt = (v: number | null) => (v == null ? "N/A" : (v * 100).toFixed(1) + "%")

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p className="min-w-[24ch] flex-1 text-[15px] leading-snug text-mm-dark">
          {lead && lead.reliability.value != null ? (
            <>
              {lead.configuration_name} passes all {k} of {k} tries on {fmt(lead.reliability.value)} of tasks
              {lead.consistency.combined != null ? `, and its repeats agree ${fmt(lead.consistency.combined)} of the time.` : "."}
            </>
          ) : groups ? (
            <>No configuration has {k} scored tries at any task yet. Run with more passes, or lower k.</>
          ) : error ? (
            <>Could not load repeat data.</>
          ) : (
            <>Loading repeats…</>
          )}
        </p>
        <div role="group" aria-label="k, the number of tries that must all pass" className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-[12px]">
          <span className="px-2 text-muted-foreground">k</span>
          {KS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === k}
              onClick={() => setK(v)}
              className={cn(
                "rounded-full px-2.5 py-1 font-medium",
                v === k ? "bg-card text-mm-dark shadow-[0_1px_2px_rgba(0,23,53,0.12)]" : "text-muted-foreground hover:text-mm-dark",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {shown.length ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="text-[12px] text-muted-foreground">
              <tr>
                <th className="pb-2 text-left font-normal">Configuration</th>
                <th className="pb-2 pl-4 text-left font-normal" title={`Share of tasks where ${k} of its tries would all pass`}>
                  Reliability, pass^{k}
                </th>
                <th className="pb-2 pl-4 text-left font-normal" title="0.7 × output agreement + 0.3 × execution-path similarity">
                  Consistency
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g, i) => (
                <tr key={`${g.configuration_id}:${g.mode}:${g.condition}`} className="border-t border-border/60 align-top">
                  <td className="py-2.5 pr-2">
                    <span className="block font-medium text-mm-dark">{g.configuration_name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {g.models} · up to {g.max_attempts_per_task} tries per task
                    </span>
                  </td>
                  <td className="py-2.5 pl-4">
                    <Meter value={g.reliability.value} lead={g === lead} reduce={reduce} delay={i} />
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {g.reliability.value == null
                        ? `needs ${k} tries per task`
                        : `${g.reliability.eligible_tasks} of ${g.tasks} tasks have ${k}+ tries`}
                    </span>
                  </td>
                  <td className="py-2.5 pl-4">
                    <Meter value={g.consistency.combined ?? g.consistency.output} lead={false} reduce={reduce} delay={i} />
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {g.consistency.output == null
                        ? "needs 2 tries per task"
                        : g.consistency.combined == null
                          ? `output ${fmt(g.consistency.output)} · no execution path recorded`
                          : `output ${fmt(g.consistency.output)} · execution ${fmt(g.consistency.execution)}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
        Reliability counts a task only when it has at least {k} scored tries, and asks how often {k} of them would all pass, so it
        can be lower than the pass rate. Consistency compares what repeats produced (the answer, or the store&rsquo;s end state)
        and the path they took (tools or program steps), whether they passed or not. Tries count together only when the
        configuration, model and prompts were identical.
        {hidden ? ` ${hidden} other configuration${hidden === 1 ? " has" : "s have"} no task with repeats yet.` : ""}
      </p>
    </div>
  )
}

function Meter({ value, lead, reduce, delay }: { value: number | null; lead: boolean; reduce: boolean; delay: number }) {
  if (value == null) return <span className="font-data text-[13px] text-muted-foreground">N/A</span>
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-[10px] w-28 overflow-hidden rounded-full bg-muted">
        <motion.span
          className={cn("absolute inset-y-0 left-0 rounded-full", lead ? "bg-mm-charge" : "bg-muted-foreground/45")}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.5, ease: EASE, delay: delay * 0.04 }}
        />
      </span>
      <span className="font-data text-[13px] text-mm-dark">{(value * 100).toFixed(1)}%</span>
    </span>
  )
}
