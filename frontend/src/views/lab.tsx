"use client"

/*
 * The Lab: find out why a result is bad or surprising, change the setup, and measure what the change
 * did. Task tabs on top; the left column leads with one takeaway (what a chosen change did, or with
 * nothing chosen, the most important problem), one huge number and the cost and accuracy chart; the
 * right column lists the problems to look into. Below the fold: what changed in the setup and which
 * questions the change fixed or broke, then every configuration behind a disclosure.
 *
 * Everything chosen lives in the URL (?benchmark=finqa&a=<before>&b=<after>&acc=90&cost=0.01), so
 * a link opens the same view. The target is also kept per viewer in localStorage.
 */

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { ArrowRight, CaretRight, CheckCircle, XCircle } from "@phosphor-icons/react"

import { pct, secs, usd, when } from "@/components/product/batch-results"
import {
  type LabDiff,
  type LabFlip,
  type LabSteadiness,
  type LabProblem,
  type LabRunPoint,
  benchmarkName,
  getLabDiff,
  getLabSteadiness,
  getLabProblems,
  getLabRuns,
  taskNoun,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { CompareLenses, HowThisWorks, MIN_N, arch, btnPrimary, btnQuiet, surface } from "@/views/compare"

const BENCHES = ["finqa", "tau2-retail", "tau-retail", "fab"]
/** Tasks in plain words, as on the Overview. */
const TASK: Record<string, string> = {
  finqa: "Financial calculation",
  "tau2-retail": "Customer service with tools",
  "tau-retail": "Customer service",
  fab: "Finance research",
}
const task = (id: string) => TASK[id] ?? benchmarkName(id)
const TARGET_KEY = "lab-target"

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0265ff]/40"
const link = cn("cursor-pointer rounded-[4px] font-medium text-mm-charge hover:underline", focusRing)
const quietLink = cn("cursor-pointer rounded-[4px] text-mm-dark underline decoration-border underline-offset-4 hover:decoration-foreground", focusRing)
const floating = "rounded-[12px] bg-card shadow-[0_2px_8px_rgba(0,23,53,0.06),0_16px_40px_-16px_rgba(0,23,53,0.2)] dark:ring-1 dark:ring-border"
/** The one ornament: a red tab above each takeaway. */
const RedTab = () => <span aria-hidden className="block h-1 w-9 rounded-full bg-mm-charge" />
/** Data blue, lifted in dark mode like the text token. */
const blueFill = "fill-[#0265ff] dark:fill-[#5b9bff]"
const blueStroke = "stroke-[#0265ff] dark:stroke-[#5b9bff]"
const redFill = "fill-[#0265ff] dark:fill-[#5b9bff]"
const redStroke = "stroke-[#0265ff] dark:stroke-[#5b9bff]"

const isMulti = (r: Pick<LabRunPoint, "architecture">) => r.architecture !== "single-agent"
const archLabel = (r: Pick<LabRunPoint, "architecture">) => (isMulti(r) ? `Multi-agent (${arch(r.architecture).label})` : "Single agent")
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function plainError(e: unknown) {
  const m = e instanceof Error ? e.message : "Something went wrong"
  return m.replace(/[.!?]$/, "")
}

/** Loads by key; a key change or a retry shows loading again. The fetcher must be stable. */
function useLoad<T>(key: string | null, fetcher: (key: string) => Promise<T>) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null)
  const full = key ? `${key}#${nonce}` : null
  useEffect(() => {
    if (!key || !full) return
    let cancelled = false
    fetcher(key)
      .then((data) => !cancelled && setState({ key: full, data }))
      .catch((e) => !cancelled && setState({ key: full, error: plainError(e) }))
    return () => {
      cancelled = true
    }
  }, [key, full, fetcher])
  const current = state && state.key === full ? state : null
  return {
    data: current?.data,
    error: current?.error,
    loading: !!key && !current,
    retry: useCallback(() => setNonce((n) => n + 1), []),
  }
}

const fetchRuns = (bench: string) => getLabRuns(bench)
const fetchProblems = () => getLabProblems()
const fetchSteadiness = (batch: string) => getLabSteadiness(batch)
const fetchDiff = (pair: string) => {
  const [a, b] = pair.split("|")
  return getLabDiff(a, b)
}

/** The "before" for an after run: that configuration's previous run, else the best run of the other architecture. */
function pickBefore(runs: LabRunPoint[], afterId: string) {
  const after = runs.find((r) => r.batch_id === afterId)
  if (!after) return null
  const newestFirst = (x: LabRunPoint, y: LabRunPoint) => y.created_at.localeCompare(x.created_at)
  // Only runs likely to share enough questions: finished, and at least half the after run's size
  const fair = (r: LabRunPoint) => r.batch_id !== afterId && r.complete && r.accuracy != null && r.questions * 2 >= after.questions
  const previous = runs
    .filter((r) => fair(r) && r.configuration_id === after.configuration_id && r.created_at < after.created_at)
    .sort(newestFirst)[0]
  if (previous) return previous.batch_id
  const other = runs
    .filter((r) => fair(r) && isMulti(r) !== isMulti(after))
    .sort((x, y) => Number(y.complete) - Number(x.complete) || (y.accuracy ?? 0) - (x.accuracy ?? 0))[0]
  if (other) return other.batch_id
  return runs.filter((r) => r.batch_id !== afterId).sort(newestFirst)[0]?.batch_id ?? null
}

export default function Lab() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const bench = params.get("benchmark") || "finqa"
  const a = params.get("a")
  const b = params.get("b")

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname],
  )

  const runs = useLoad(bench, fetchRuns)
  const problems = useLoad("all", fetchProblems)
  const pair = a && b && a !== b ? `${a}|${b}` : null
  const diff = useLoad(pair, fetchDiff)
  const steady = useLoad(pair ? b : null, fetchSteadiness)

  // Only an "after" chosen: pick its "before" for it
  useEffect(() => {
    if (!b || a || !runs.data) return
    const before = pickBefore(runs.data.runs, b)
    if (before) setParams({ a: before })
  }, [a, b, runs.data, setParams])

  const target = useTarget(setParams)
  const [allConfigs, setAllConfigs] = useState(false)

  useEffect(() => {
    document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [bench])

  function pick(id: string, asBefore: boolean) {
    if (asBefore) {
      if (id === b) setParams({ a: id, b: a })
      else setParams({ a: id })
    } else if (id === a) {
      setParams({ a: b, b: id })
    } else {
      // keep a "before" already chosen; with none, one is picked for this run
      setParams({ b: id })
    }
  }
  const open = (p: LabProblem) => setParams({ benchmark: p.benchmark_id, b: p.batch_id, a: p.other_batch_id })

  const list = runs.data?.runs ?? []
  const allProblems = problems.data?.problems ?? []
  // With nothing chosen, the most important problem (on this task, if it has one) leads on the left and leaves the list
  const lead = pair ? null : allProblems.find((p) => p.benchmark_id === bench) ?? allProblems[0] ?? null
  const rest = lead ? allProblems.filter((p) => p !== lead) : allProblems

  const map = runs.loading ? (
    <div aria-hidden className="h-[240px] animate-pulse rounded-[4px] bg-muted/60 sm:h-[300px]" />
  ) : runs.error ? (
    <ErrorLine what="The runs" message={runs.error} onRetry={runs.retry} />
  ) : !list.length ? (
    <p className="border-t border-border py-8 text-[13px] text-mm-dark">
      No runs on {task(bench)} yet.{" "}
      <Link href="/configurations" className={link}>
        Run a configuration
      </Link>
    </p>
  ) : (
    <TradeOffMap runs={list} a={a} b={b} bench={bench} target={target.value} onPick={pick} />
  )

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-1 sm:px-6">
        <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-mm-dark">Lab</h2>
      <div role="tablist" aria-label="Task" className="flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5 [scrollbar-width:none]">
        {BENCHES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === bench}
            title={benchmarkName(id)}
            onClick={() => id !== bench && setParams({ benchmark: id, a: null, b: null })}
            className={cn(
              "shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
              focusRing,
              id === bench ? "bg-card text-mm-dark shadow-[0_1px_2px_rgba(0,23,53,0.08)]" : "text-muted-foreground hover:text-mm-dark",
            )}
          >
            {task(id)}
          </button>
        ))}
      </div>
      </header>

      <div className={cn("mt-5 grid gap-y-12 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[1.25fr_1fr] lg:gap-x-14", surface)}>
        <section className="min-w-0" aria-label={pair ? "What the change did" : "Where to start"}>
          {pair ? (
            diff.loading ? (
              <LeadSkeleton />
            ) : diff.error ? (
              <ErrorLine what="The comparison" message={diff.error} onRetry={diff.retry} />
            ) : diff.data ? (
              <PairLead d={diff.data} bench={bench} />
            ) : null
          ) : problems.loading ? (
            <LeadSkeleton />
          ) : lead ? (
            <ProblemLead p={lead} onOpen={() => open(lead)} />
          ) : problems.error ? (
            <ErrorLine what="The problems" message={problems.error} onRetry={problems.retry} />
          ) : (
            <div>
              <RedTab />
              <h3 className="mt-3.5 text-[17px] font-semibold text-mm-dark">Nothing to look into yet</h3>
              <p className="mt-2 text-[15px] text-muted-foreground">
                <Link href="/configurations" className={link}>
                  Run a configuration
                </Link>{" "}
                on a task to start.
              </p>
            </div>
          )}

          <PairLine runs={list} loaded={!!runs.data} a={a} b={b} bench={bench} onChange={setParams} />

          <div className="mt-9">{map}</div>
          {list.length ? <TargetSentence target={target} /> : null}
        </section>

        <aside className="min-w-0" aria-label="Problems to look into">
          <Problems state={problems} items={rest} current={pair} onOpen={open} />
        </aside>
      </div>

      {/* Below the opening row: what changed, and the questions it fixed or broke */}
      {pair && diff.data ? <Evidence d={diff.data} /> : null}
      {pair && diff.data && steady.data ? <Steadiness s={steady.data} bench={bench} /> : null}

      {/* Every configuration's standing, and what has run where */}
      <div className="mt-8 px-1 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <button
            type="button"
            onClick={() => setAllConfigs((v) => !v)}
            aria-expanded={allConfigs}
            className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] text-[15px] font-semibold text-mm-dark hover:text-[#0265ff] dark:hover:text-[#5b9bff]", focusRing)}
          >
            All configurations
            <CaretRight weight="bold" className={cn("size-3.5 transition-transform duration-200", allConfigs && "rotate-90")} aria-hidden />
          </button>
          <HowThisWorks benches={BENCHES} className="" />
        </div>
      </div>
      {allConfigs ? <CompareLenses className="mt-3" /> : null}
    </div>
  )
}

function ErrorLine({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4 text-[13px]">
      <span className="text-mm-dark">
        {what} couldn&rsquo;t load ({message}).
      </span>
      <button type="button" onClick={onRetry} className={cn(btnQuiet, "cursor-pointer", focusRing)}>
        Try again
      </button>
    </div>
  )
}

function LeadSkeleton() {
  return (
    <div aria-hidden>
      <RedTab />
      <div className="mt-3.5 h-5 w-[min(100%,420px)] animate-pulse rounded bg-muted" />
      <div className="mt-4 h-[64px] w-[260px] animate-pulse rounded bg-muted sm:h-[84px]" />
      <div className="mt-5 h-5 w-[min(100%,300px)] animate-pulse rounded bg-muted" />
    </div>
  )
}

/* ── Target ─────────────────────────────────────────────────────────────── */

type Target = { acc: number | null; cost: number | null }

function parseTarget(accText: string, costText: string): Target {
  const acc = parseFloat(accText)
  const cost = parseFloat(costText.replace(/^\$/, ""))
  return {
    acc: Number.isFinite(acc) && acc > 0 && acc <= 100 ? acc / 100 : null,
    cost: Number.isFinite(cost) && cost > 0 ? cost : null,
  }
}

/** The target, from the URL first, else this viewer's last one; edits go to both. */
function useTarget(setParams: (patch: Record<string, string | null>) => void) {
  const params = useSearchParams()
  const [accText, setAccText] = useState(() => params.get("acc") ?? "")
  const [costText, setCostText] = useState(() => params.get("cost") ?? "")
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (params.get("acc") || params.get("cost")) return
    try {
      const saved = JSON.parse(window.localStorage.getItem(TARGET_KEY) ?? "null") as { acc?: string; cost?: string } | null
      if (saved && (saved.acc || saved.cost)) {
        setAccText(saved.acc ?? "")
        setCostText(saved.cost ?? "")
        setParams({ acc: saved.acc || null, cost: saved.cost || null })
      }
    } catch {
      /* storage unavailable: no saved target */
    }
  }, [params, setParams])

  const update = (next: { acc?: string; cost?: string }) => {
    const acc = next.acc ?? accText
    const cost = next.cost ?? costText
    if (next.acc !== undefined) setAccText(acc)
    if (next.cost !== undefined) setCostText(cost)
    setParams({ acc: acc || null, cost: cost || null })
    try {
      window.localStorage.setItem(TARGET_KEY, JSON.stringify({ acc, cost }))
    } catch {
      /* storage unavailable: the URL still carries it */
    }
  }
  return { accText, costText, update, value: parseTarget(accText, costText) }
}

function TargetSentence({ target }: { target: ReturnType<typeof useTarget> }) {
  const input =
    "h-7 rounded-[6px] border border-border bg-card px-1.5 text-right font-data text-[12px] text-mm-dark placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0265ff]/40"
  const set = target.value.acc != null || target.value.cost != null
  const [open, setOpen] = useState(false)
  if (!set && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn("mt-3 text-[12px]", quietLink)}>
        Set a target
      </button>
    )
  }
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12px] text-muted-foreground">
      <span>Target: at least</span>
      <label className="inline-flex items-center gap-1">
        <span className="sr-only">Accuracy target, percent</span>
        <input
          inputMode="decimal"
          value={target.accText}
          onChange={(e) => target.update({ acc: e.target.value.replace(/[^\d.]/g, "") })}
          placeholder="any"
          autoFocus={!set}
          className={cn(input, "w-[4.5ch] min-w-11")}
        />
        <span>%</span>
      </label>
      <span>accurate, at most</span>
      <label className="inline-flex items-center gap-1">
        <span aria-hidden>$</span>
        <span className="sr-only">Cost per correct answer target, dollars</span>
        <input
          inputMode="decimal"
          value={target.costText}
          onChange={(e) => target.update({ cost: e.target.value.replace(/[^\d.]/g, "") })}
          placeholder="any"
          className={cn(input, "w-[7ch] min-w-14")}
        />
      </label>
      <span>per correct answer</span>
      <button
        type="button"
        onClick={() => {
          target.update({ acc: "", cost: "" })
          setOpen(false)
        }}
        className={cn("ml-1.5", link)}
      >
        {set ? "Clear" : "Cancel"}
      </button>
    </p>
  )
}

/* ── Trade-off map ──────────────────────────────────────────────────────── */

const fmtCost = (v: number) => `$${Number(v.toPrecision(2))}`

function costTicks(lo: number, hi: number, log: boolean) {
  if (log) {
    const out: number[] = []
    for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** k
        if (v >= lo && v <= hi) out.push(v)
      }
    }
    if (out.length <= 7) return out
    const lead = (v: number) => Math.round(v / 10 ** Math.floor(Math.log10(v) + 1e-9))
    const ones = out.filter((v) => lead(v) !== 2)
    return ones.length <= 7 ? ones : out.filter((v) => lead(v) === 1)
  }
  const raw = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(Number(v.toPrecision(6)))
  return out
}

function TradeOffMap({
  runs,
  a,
  b,
  bench,
  target,
  onPick,
}: {
  runs: LabRunPoint[]
  a: string | null
  b: string | null
  bench: string
  target: Target
  onPick: (id: string, asBefore: boolean) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element
      if (!t.closest("[data-lab-menu]") && !t.closest("[data-lab-point]")) setMenu(null)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown)
    }
  }, [menu])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const placed = runs.filter((r) => r.accuracy != null && r.cost_per_correct_usd != null && r.cost_per_correct_usd > 0)
  const off = runs.length - placed.length
  const height = width && width < 520 ? 240 : 300
  const m = { l: 44, r: 14, t: 26, b: 40 }

  const scale = useMemo(() => {
    const costs = placed.map((r) => r.cost_per_correct_usd!)
    if (target.cost) costs.push(target.cost)
    const accs = placed.map((r) => r.accuracy!)
    if (target.acc != null) accs.push(target.acc)
    const cMin = Math.min(...costs), cMax = Math.max(...costs)
    const log = cMax / cMin >= 8
    const [x0, x1] = log ? [cMin / 1.6, cMax * 1.6] : cMin === cMax ? [cMin * 0.5, cMax * 1.5] : [Math.max(0, cMin - (cMax - cMin) * 0.15), cMax + (cMax - cMin) * 0.15]
    let y1 = Math.min(1, Math.ceil((Math.max(...accs) + 0.04) * 10) / 10)
    let y0 = Math.max(0, Math.floor((Math.min(...accs) - 0.04) * 10) / 10)
    if (y1 - y0 < 0.2) {
      y0 = Math.max(0, y1 - 0.2)
      y1 = Math.min(1, y0 + 0.2)
    }
    const span = y1 - y0
    const yStep = span <= 0.25 ? 0.05 : span <= 0.5 ? 0.1 : 0.2
    const yTicks: number[] = []
    for (let v = Math.ceil(y0 / yStep - 1e-9) * yStep; v <= y1 + 1e-9; v += yStep) yTicks.push(Number(v.toFixed(4)))
    // Room for about one cost label per 64px
    const all = costTicks(x0, x1, log)
    const room = Math.max(2, Math.floor((Math.max(width, 280) - 66) / 64))
    const every = Math.ceil(all.length / room)
    const xTicks = all.filter((_, i) => i % every === 0)
    return { log, x0, x1, y0, y1, xTicks, yTicks }
  }, [placed, target.acc, target.cost, width])

  const W = Math.max(width, 280)
  const sx = (v: number) =>
    m.l + (scale.log ? (Math.log(v) - Math.log(scale.x0)) / (Math.log(scale.x1) - Math.log(scale.x0)) : (v - scale.x0) / (scale.x1 - scale.x0)) * (W - m.l - m.r)
  const sy = (v: number) => m.t + (1 - (v - scale.y0) / (scale.y1 - scale.y0)) * (height - m.t - m.b)
  const pos = (r: LabRunPoint) => ({ x: sx(r.cost_per_correct_usd!), y: sy(r.accuracy!) })

  // The finding, for screen readers: who meets the target, or who leads
  const meets = placed.filter((r) => (target.acc == null || r.accuracy! >= target.acc) && (target.cost == null || r.cost_per_correct_usd! <= target.cost))
  const hasTarget = target.acc != null || target.cost != null
  const cheapest = [...meets].sort((x, y) => x.cost_per_correct_usd! - y.cost_per_correct_usd!)[0]
  // A few-question test run can score 100% by luck; it never leads
  const sized = placed.filter((r) => r.questions >= MIN_N)
  const top = [...(sized.length ? sized : placed)].sort((x, y) => y.accuracy! - x.accuracy! || x.cost_per_correct_usd! - y.cost_per_correct_usd!)[0]
  const finding = hasTarget
    ? meets.length
      ? `${meets.length} of ${placed.length} ${placed.length === 1 ? "run meets" : "runs meet"} your target; the cheapest is ${cheapest.configuration_name}.`
      : "No run meets your target yet."
    : top
      ? `Most accurate: ${top.configuration_name}, ${pct(top.accuracy, 1)} at ${usd(top.cost_per_correct_usd)} per correct answer.`
      : ""

  const before = placed.find((r) => r.batch_id === a)
  const after = placed.find((r) => r.batch_id === b)
  const hovered = placed.find((r) => r.batch_id === hover)
  const menuRun = placed.find((r) => r.batch_id === menu)
  // Draw the chosen pair last so they sit on top
  const order = [...placed].sort((x, y) => rank(x) - rank(y))
  function rank(r: LabRunPoint) {
    return r.batch_id === b ? 2 : r.batch_id === a ? 1 : 0
  }

  // A chosen point's label sits beside it, on whichever side has room; with no room for the name, just "Before"/"After"
  const pairLabel = (r: LabRunPoint, x: number) => {
    const word = r.batch_id === b ? "After" : "Before"
    const full = `${word} · ${short(r.configuration_name)}`
    const fits = (t: string) => x + 12 + t.length * 6.6 <= W || x - 12 - t.length * 6.6 >= 0
    return fits(full) ? full : word
  }
  // Two chosen points near each other: their labels point away from each other (left one left, right one right);
  // where a label has no room on its outer side, they stack instead, one above and one below
  const near = !!before && !!after && Math.abs(pos(before).y - pos(after).y) < 30 && Math.abs(pos(before).x - pos(after).x) < 260
  const room = (r: LabRunPoint, x: number, side: "left" | "right") =>
    side === "right" ? x + 12 + pairLabel(r, x).length * 6.6 <= W : x - 12 - pairLabel(r, x).length * 6.6 >= 0
  const outer = (r: LabRunPoint): "left" | "right" => {
    const other = r.batch_id === b ? before! : after!
    return pos(r).x < pos(other).x || (pos(r).x === pos(other).x && r.batch_id === a) ? "left" : "right"
  }
  const apart = near && room(before!, pos(before!).x, outer(before!)) && room(after!, pos(after!).x, outer(after!))
  const close = near && !apart
  const labelSide = (r: LabRunPoint, x: number) =>
    apart ? outer(r) : x + 12 + pairLabel(r, x).length * 6.6 <= W ? "right" : "left"

  // Target region: cheaper than the cost target (left) and above the accuracy target
  const tx = target.cost ? Math.min(Math.max(sx(target.cost), m.l), W - m.r) : W - m.r
  const ty = target.acc != null ? Math.min(Math.max(sy(target.acc), m.t), height - m.b) : height - m.b

  return (
    <div>
      <h3 className="sr-only">Every run on {task(bench)}</h3>
      {finding ? <p className="sr-only">{finding}</p> : null}

      <div ref={box} className="relative w-full" style={{ height }} title="Click a run to compare it with another">
        {width ? (
          <svg width={W} height={height} role="group" aria-label="Every run by cost per correct answer and accuracy" className="block overflow-visible">
            {hasTarget ? (
              <g>
                <rect x={m.l} y={m.t} width={Math.max(0, tx - m.l)} height={Math.max(0, ty - m.t)} className={blueFill} opacity={0.06} />
                <text x={m.l + 8} y={m.t + 14} className="fill-muted-foreground" style={{ fontSize: 12 }}>
                  Your target
                </text>
              </g>
            ) : null}
            {scale.yTicks.map((v) => (
              <g key={`y${v}`}>
                <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="stroke-border" />
                <text x={m.l - 8} y={sy(v) + 4} textAnchor="end" className="fill-muted-foreground font-data" style={{ fontSize: 12 }}>
                  {Math.round(v * 100)}%
                </text>
              </g>
            ))}
            {scale.xTicks.filter((v) => sx(v) - m.l >= 26).map((v) => (
              <text key={`x${v}`} x={sx(v)} y={height - m.b + 17} textAnchor="middle" className="fill-muted-foreground font-data" style={{ fontSize: 12 }}>
                {fmtCost(v)}
              </text>
            ))}
            <text x={W - m.r} y={height - 1} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 12 }}>
              Cost per correct answer
            </text>
            <text x={0} y={m.t - 14} textAnchor="start" className="fill-muted-foreground" style={{ fontSize: 12 }}>
              Accuracy
            </text>

            {before && after ? <ChangeArrow from={pos(before)} to={pos(after)} /> : null}

            {order.map((r) => {
              const { x, y } = pos(r)
              const role = r.batch_id === b ? "after" : r.batch_id === a ? "before" : null
              const multi = isMulti(r)
              const size = role ? 6 : r.questions < MIN_N ? 3.5 : 4.5
              const fill =
                role === "after" ? redFill : role === "before" ? "fill-foreground" : r.complete ? "fill-[#b3c2d6] dark:fill-[#56697d]" : "fill-card"
              const stroke = role || r.complete ? "stroke-card" : "stroke-[#b3c2d6] dark:stroke-[#56697d]"
              const label = `${r.configuration_name}, ${archLabel(r)}: ${pct(r.accuracy, 1)} accurate at ${usd(r.cost_per_correct_usd)} per correct answer, ${when(r.created_at)}${r.complete ? "" : ", didn't finish"}${role ? `. Chosen as the ${role} run` : ""}`
              return (
                <g
                  key={r.batch_id}
                  transform={`translate(${x},${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={!!role}
                  data-lab-point
                  className="group cursor-pointer outline-none"
                  onClick={() => setMenu((cur) => (cur === r.batch_id ? null : r.batch_id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setMenu((cur) => (cur === r.batch_id ? null : r.batch_id))
                    }
                  }}
                  onMouseEnter={() => setHover(r.batch_id)}
                  onMouseLeave={() => setHover((h) => (h === r.batch_id ? null : h))}
                  onFocus={() => setHover(r.batch_id)}
                  onBlur={() => setHover((h) => (h === r.batch_id ? null : h))}
                >
                  <circle r={14} fill="transparent" />
                  <circle r={size + 5} className={cn("fill-none opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-100", blueStroke)} strokeWidth={2} />
                  {multi ? (
                    <rect x={-size} y={-size} width={size * 2} height={size * 2} className={cn(fill, stroke)} strokeWidth={1.5} />
                  ) : (
                    <circle r={size + 0.6} className={cn(fill, stroke)} strokeWidth={1.5} />
                  )}
                  {role ? (
                    <text
                      // beside the point, on the side away from the arrow, kept clear of the chart edges
                      x={labelSide(r, x) === "left" ? -12 : 12}
                      y={close ? (role === "after" ? 18 : -10) : 4}
                      textAnchor={labelSide(r, x) === "left" ? "end" : "start"}
                      paintOrder="stroke"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      className={cn("stroke-card", role === "after" ? redFill : "fill-foreground")}
                      style={{ fontSize: 12 }}
                    >
                      {pairLabel(r, x)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {menuRun && width ? (
          <PointMenu
            r={menuRun}
            x={pos(menuRun).x}
            y={pos(menuRun).y}
            width={W}
            role={menuRun.batch_id === b ? "after" : menuRun.batch_id === a ? "before" : null}
            onPick={(asBefore) => {
              onPick(menuRun.batch_id, asBefore)
              setMenu(null)
            }}
          />
        ) : hovered && width ? (
          <MapTip r={hovered} x={pos(hovered).x} y={pos(hovered).y} width={W} />
        ) : null}
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4.5" className="fill-[#b3c2d6] dark:fill-[#56697d]" />
          </svg>
          Single agent
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <rect x="1" y="1" width="8" height="8" className="fill-[#b3c2d6] dark:fill-[#56697d]" />
          </svg>
          Multi-agent
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="3.8" className="fill-none stroke-[#b3c2d6] dark:stroke-[#56697d]" strokeWidth="1.5" />
          </svg>
          Didn&rsquo;t finish
        </li>
        {off ? (
          <li title="Runs with no correct answers have no cost per correct answer">
            {off} {off === 1 ? "run" : "runs"} not shown
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/** The change, drawn from the before run to the after run. */
function ChangeArrow({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }) {
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 24) return null
  const ux = dx / len, uy = dy / len
  return (
    <line
      x1={from.x + ux * 10}
      y1={from.y + uy * 10}
      x2={to.x - ux * 11}
      y2={to.y - uy * 11}
      className={redStroke}
      strokeWidth={1.5}
    />
  )
}

const short = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name)

/** What a run is, and the two ways to use it in a comparison. */
function PointMenu({
  r,
  x,
  y,
  width,
  role,
  onPick,
}: {
  r: LabRunPoint
  x: number
  y: number
  width: number
  role: "before" | "after" | null
  onPick: (asBefore: boolean) => void
}) {
  const left = Math.min(Math.max(x, 140), width - 140)
  const below = y < 150
  const choice = cn(btnQuiet, "h-8 cursor-pointer px-3", focusRing)
  return (
    <div
      data-lab-menu
      role="dialog"
      aria-label={`${r.configuration_name}: compare`}
      className={cn("absolute z-20 w-[260px] px-4 py-3 text-[12px] leading-snug", floating)}
      style={{ left, top: below ? y + 16 : y - 16, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
    >
      <p className="truncate text-[13px] font-medium text-mm-dark">{r.configuration_name}</p>
      <p className="text-muted-foreground">
        {archLabel(r)} · {when(r.created_at)}
        {r.questions < MIN_N ? ` · test run, ${r.questions} ${r.questions === 1 ? "question" : "questions"}` : ""}
        {r.complete ? "" : " · didn’t finish"}
      </p>
      <p className="mt-1 font-data text-mm-dark">
        {pct(r.accuracy, 1)} accurate · {usd(r.cost_per_correct_usd)} per correct answer
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" autoFocus onClick={() => onPick(true)} className={choice} aria-pressed={role === "before"}>
          Compare from this
        </button>
        <button type="button" onClick={() => onPick(false)} className={choice} aria-pressed={role === "after"}>
          Compare to this
        </button>
      </div>
    </div>
  )
}

function MapTip({ r, x, y, width }: { r: LabRunPoint; x: number; y: number; width: number }) {
  const left = Math.min(Math.max(x, 130), width - 130)
  const below = y < 90
  return (
    <div
      role="tooltip"
      className={cn("pointer-events-none absolute z-10 w-max max-w-[260px] px-3 py-2 text-[12px] leading-snug", floating)}
      style={{ left, top: below ? y + 16 : y - 16, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
    >
      <p className="truncate text-[13px] font-medium text-mm-dark">{r.configuration_name}</p>
      <p className="text-muted-foreground">{archLabel(r)}</p>
      <p className="mt-1 font-data text-mm-dark">
        {pct(r.accuracy, 1)} · {usd(r.cost_per_correct_usd)} per correct
      </p>
      <p className="text-muted-foreground">
        {when(r.created_at)}
        {r.complete ? "" : " · didn't finish"}
      </p>
    </div>
  )
}

/* ── Choosing the pair ──────────────────────────────────────────────────── */

/** One quiet line naming the pair, with Change (the two pickers) and Swap. */
function PairLine({
  runs,
  loaded,
  a,
  b,
  bench,
  onChange,
}: {
  runs: LabRunPoint[]
  loaded: boolean
  a: string | null
  b: string | null
  bench: string
  onChange: (patch: Record<string, string | null>) => void
}) {
  const [editing, setEditing] = useState(false)
  const sorted = useMemo(() => [...runs].sort((x, y) => y.created_at.localeCompare(x.created_at)), [runs])
  const byId = (id: string | null) => (id ? runs.find((r) => r.batch_id === id) : undefined)
  // A run from another task (opened by link) still shows as chosen; while runs load, say nothing
  const known = (id: string | null) => !id || !runs.length || runs.some((r) => r.batch_id === id)
  const name = (id: string | null) => {
    const r = byId(id)
    return r ? `${r.configuration_name}, ${day(r.created_at)}` : id ? (loaded ? "another task’s run" : "…") : "pick a run"
  }
  const half = !!(a || b) && !(a && b)
  const open = editing || (half && runs.length > 1)
  const select =
    "h-8 w-full min-w-0 cursor-pointer truncate rounded-[6px] border border-border bg-card px-2 text-[13px] text-mm-dark hover:border-muted-foreground sm:w-auto sm:max-w-[280px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0265ff]/40"
  const option = (r: LabRunPoint) => `${r.configuration_name} · ${pct(r.accuracy, 0)} · ${day(r.created_at)}`
  const action = cn("cursor-pointer rounded-[4px] text-mm-charge hover:underline disabled:cursor-not-allowed disabled:opacity-50", focusRing)

  return (
    <div className={cn("mt-5 text-[13px] text-muted-foreground transition-opacity", (a || b) && !loaded && "opacity-0")}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {a || b ? (
          <>
            <span className="min-w-0 basis-full truncate text-mm-dark sm:max-w-[70%] sm:basis-auto">
              {name(a)} <span className="text-muted-foreground">&rarr;</span> {name(b)}
            </span>
            <span className="inline-flex items-baseline gap-x-2 whitespace-nowrap">
              <span aria-hidden className="hidden sm:inline">·</span>
              <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={open} className={action}>
                Change
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => onChange({ a: b, b: a })} disabled={!a || !b} className={action}>
                Swap
              </button>
            </span>
          </>
        ) : (
          <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={open} className={action}>
            Compare any two runs on {task(bench)}
          </button>
        )}
      </p>
      {b && !a && loaded && runs.length < 2 ? <p className="mt-2 text-mm-dark">No other run on {task(bench)} to compare this one with yet.</p> : null}
      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
          <label className="w-full sm:w-auto">
            <span className="sr-only">Before</span>
            <select value={a ?? ""} onChange={(e) => onChange({ a: e.target.value || null })} className={select}>
              <option value="">Before: pick a run</option>
              {!known(a) ? <option value={a!}>Another task&rsquo;s run</option> : null}
              {sorted.map((r) => (
                <option key={r.batch_id} value={r.batch_id}>
                  {option(r)}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight className="hidden size-3.5 shrink-0 sm:block" aria-hidden />
          <label className="w-full sm:w-auto">
            <span className="sr-only">After</span>
            <select value={b ?? ""} onChange={(e) => onChange({ b: e.target.value || null })} className={select}>
              <option value="">After: pick a run</option>
              {!known(b) ? <option value={b!}>Another task&rsquo;s run</option> : null}
              {sorted.map((r) => (
                <option key={r.batch_id} value={r.batch_id}>
                  {option(r)}
                </option>
              ))}
            </select>
          </label>
          {a || b ? (
            <button type="button" onClick={() => onChange({ a: null, b: null })} className={cn("ml-1", action)}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ── What the change did ────────────────────────────────────────────────── */

const round1 = (n: number) => Number(n.toFixed(1))

/** "2.7× the cost", "10% costlier", "30% cheaper" */
function costPhrase(a: number | null, b: number | null) {
  if (!a || !b) return null
  const r = b / a
  if (Math.abs(r - 1) < 0.03) return "same cost"
  if (r >= 2) return `${r.toFixed(1)}× the cost`
  return r > 1 ? `${Math.round((r - 1) * 100)}% costlier` : `${Math.round((1 - r) * 100)}% cheaper`
}
/** "0.4s slower" */
function timePhrase(a: number | null, b: number | null) {
  if (a == null || b == null) return null
  const d = b - a
  if (Math.abs(d) < 0.05 || (a > 0 && Math.abs(d) / a < 0.03)) return "same speed"
  return `${secs(Math.abs(d))} ${d > 0 ? "slower" : "faster"}`
}

/** The takeaway, as a sentence, from the direction of the change. */
function takeaway(d: LabDiff, points: number) {
  if (d.verdict === "no-change" || points === 0) {
    // Same accuracy: the news is what it cost and how long it took
    const cost = costPhrase(d.cost_per_correct.a, d.cost_per_correct.b)
    const time = timePhrase(d.time_per_question.a, d.time_per_question.b)
    const gains = [cost?.endsWith("cheaper") ? cost : null, time?.endsWith("faster") ? time : null].filter(Boolean)
    const losses = [cost && /costlier|× the cost/.test(cost) ? cost : null, time?.endsWith("slower") ? time : null].filter(Boolean)
    if (gains.length && !losses.length) return `Just as accurate, and ${gains.join(" and ")}`
    if (losses.length && !gains.length) return `Just as accurate, but ${losses.join(" and ")}`
    return "No real difference in accuracy"
  }
  const dir = points > 0 ? "more" : "less"
  const named = d.a.configuration_name !== d.b.configuration_name
  if (d.verdict === "too-close") {
    const moved = points > 0 ? "higher" : "lower"
    if (d.same_config) return `Scored ${moved} this time, but it’s too close to call`
    return `${named ? d.b.configuration_name : "The change"} scored ${moved}, but it’s too close to call`
  }
  if (d.same_config) return `${cap(dir)} accurate this time, with the same setup`
  // Named as on the chart and in the pair line, so the three agree
  if (named) return `${d.b.configuration_name} is ${dir} accurate than ${d.a.configuration_name}`
  return `The change made it ${dir} accurate`
}

function PairLead({ d, bench }: { d: LabDiff; bench: string }) {
  const noun = (n: number) => taskNoun(bench, n)
  if (!d.comparable || d.verdict === "not-comparable" || d.accuracy.a == null || d.accuracy.b == null) {
    return (
      <div>
        <RedTab />
        <h3 className="mt-3.5 text-[15px] font-semibold leading-snug text-muted-foreground text-balance">These two runs can&rsquo;t be compared fairly</h3>
        <p className="mt-3 tabular-nums text-[64px] font-semibold leading-[0.95] tracking-[-0.03em] text-mm-dark sm:text-[88px]">
          {d.shared}
          <span className="ml-3 text-[22px] font-normal tracking-normal text-muted-foreground sm:text-[28px]">{noun(d.shared)} in common</span>
        </p>
        <p className="mt-4 text-[15px] text-muted-foreground">Too few shared {noun(2)} to judge. Pick another run on the chart.</p>
      </div>
    )
  }
  const points = round1((d.accuracy.b - d.accuracy.a) * 100)
  const rel = d.accuracy.a > 0 ? Math.round((Math.abs(d.accuracy.b - d.accuracy.a) / d.accuracy.a) * 100) : null
  const sign = points > 0 ? "+" : points < 0 ? "−" : ""
  const trade = [
    { text: costPhrase(d.cost_per_correct.a, d.cost_per_correct.b), title: `${usd(d.cost_per_correct.a)} → ${usd(d.cost_per_correct.b)} per correct answer` },
    { text: timePhrase(d.time_per_question.a, d.time_per_question.b), title: `${secs(d.time_per_question.a)} → ${secs(d.time_per_question.b)} per ${noun(1)}` },
  ].filter((p): p is { text: string; title: string } => !!p.text)
  const verdict =
    d.verdict === "real"
      ? "A real difference, not luck."
      : d.verdict === "too-close"
        ? d.more_questions
          ? `About ${d.more_questions} more would settle it${d.cost_to_settle_usd ? ` (about ${usd(d.cost_to_settle_usd)})` : ""}.`
          : ""
        : "No real difference."

  return (
    <div>
      <RedTab />
      <h3 className="mt-3.5 text-[15px] font-semibold leading-snug text-muted-foreground text-balance">{takeaway(d, points)}</h3>
      <p
        className="mt-3 cursor-help tabular-nums text-[64px] font-semibold leading-[0.95] tracking-[-0.03em] text-mm-dark sm:text-[88px]"
        title={`${pct(d.accuracy.a, 1)} → ${pct(d.accuracy.b, 1)} accurate${rel ? ` (${rel}% ${points > 0 ? "more" : "less"})` : ""}`}
      >
        {sign}
        {Math.abs(points)} pts
      </p>
      {trade.length ? (
        <p className="mt-4 text-[20px] text-mm-dark sm:text-[22px]">
          {trade.map((p, i) => (
            <span key={p.text}>
              {i ? <span className="text-muted-foreground">{" · "}</span> : null}
              <span title={p.title} className="cursor-help">
                {i ? p.text : cap(p.text)}
              </span>
            </span>
          ))}
        </p>
      ) : null}
      <p className="mt-2.5 text-[15px] text-muted-foreground text-pretty">
        Same {d.shared} {noun(d.shared)}. {verdict}
      </p>
    </div>
  )
}

/** Below the fold: what changed in the setup, and the questions it fixed or broke. */
function Evidence({ d }: { d: LabDiff }) {
  const comparable = d.comparable && d.verdict !== "not-comparable"
  return (
    <div className={cn("mt-4 grid gap-y-8 px-5 py-6 sm:px-8 sm:py-7 lg:grid-cols-[1.25fr_1fr] lg:gap-x-14", surface)}>
      <Changes d={d} />
      <div className="min-w-0">
        {comparable ? (
          <>
            <FlipList
              title={d.same_config ? "Right only this time" : "Fixed by the change"}
              tone="fixed"
              flips={d.fixed}
              before={d.a.configuration_name}
              after={d.b.configuration_name}
            />
            <FlipList title={d.same_config ? "Wrong only this time" : "Broke"} tone="broke" flips={d.broke} before={d.a.configuration_name} after={d.b.configuration_name} />
          </>
        ) : null}
        <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-[12px] text-muted-foreground">
          {comparable && (d.still_right || d.still_wrong) ? (
            <span>
              {[d.still_right ? `${d.still_right} still right` : "", d.still_wrong ? `${d.still_wrong} still wrong` : ""].filter(Boolean).join(", ")} in both
            </span>
          ) : null}
          <Link href={`/runs/e2e/${d.a.batch_id}`} className={link}>
            Open the before run
          </Link>
          <Link href={`/runs/e2e/${d.b.batch_id}`} className={link}>
            Open the after run
          </Link>
        </p>
      </div>
    </div>
  )
}

/** What differs between the two setups. */
function Changes({ d }: { d: LabDiff }) {
  const isStep = (c: LabDiff["changes"][number]) => /^node (added|removed)/i.test(c.what)
  // The names and architectures are already on the chart and in the pair line
  const rows = d.changes.filter((c) => !isStep(c) && !/^(configuration|architecture)$/i.test(c.what.trim()))
  const steps = d.changes.filter(isStep)
  return (
    <div className="min-w-0">
      <h4 className="text-[15px] font-semibold text-mm-dark">What changed</h4>
      {d.same_config ? (
        <p className="mt-2 text-[13px] text-mm-dark">Same setup, so this is run-to-run variation.</p>
      ) : rows.length || steps.length ? (
        <dl className="mt-3 space-y-4">
          {steps.length ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Steps</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                {steps.map((c, i) => {
                  const added = /^node added/i.test(c.what)
                  const name = (added ? c.after : c.before) ?? "unnamed"
                  return (
                    <span key={i} className={added ? "text-mm-dark" : "text-muted-foreground line-through"} title={added ? "Step added" : "Step removed"}>
                      <span aria-hidden>{added ? "+" : "−"}</span>
                      <span className="sr-only">{added ? "added " : "removed "}</span>
                      {name}
                    </span>
                  )
                })}
              </dd>
            </div>
          ) : null}
          {rows.map((c, i) => (
            <Change key={`${c.what}-${i}`} c={c} />
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[13px] text-mm-dark">No setting differs.</p>
      )}
    </div>
  )
}

function Change({ c }: { c: LabDiff["changes"][number] }) {
  const [all, setAll] = useState(false)
  const long = (t: string | null) => !!t && (t.length > 80 || t.includes("\n"))
  const tall = (t: string | null) => !!t && (t.split("\n").length > 3 || t.length > 260)
  const added = /^node added/i.test(c.what), removed = /^node removed/i.test(c.what)
  if (added || removed) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{added ? "Step added" : "Step removed"}</dt>
        <dd className={cn(added ? "text-mm-dark" : "text-muted-foreground line-through")}>{(added ? c.after : c.before) ?? "unnamed"}</dd>
      </div>
    )
  }
  if (!long(c.before) && !long(c.after)) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{c.what}</dt>
        <dd className="flex min-w-0 items-center gap-2 font-data text-mm-dark">
          <span className="text-muted-foreground">{c.before ?? "none"}</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
          <span>{c.after ?? "none"}</span>
        </dd>
      </div>
    )
  }
  const block = (label: string, text: string | null) => (
    <div className="min-w-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-mm-dark", !all && "line-clamp-3")}>{text ?? "none"}</p>
    </div>
  )
  return (
    <div className="text-[13px]">
      <dt className="text-muted-foreground">{c.what}</dt>
      <dd className="mt-2">
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {block("Before", c.before)}
          {block("After", c.after)}
        </div>
        {tall(c.before) || tall(c.after) ? (
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={cn("mt-2 text-[12px]", link)}>
            {all ? "Show less" : "Show all"}
          </button>
        ) : null}
      </dd>
    </div>
  )
}

const SHOWN = 5

function FlipList({ title, tone, flips, before, after }: { title: string; tone: "fixed" | "broke"; flips: LabFlip[]; before: string; after: string }) {
  const [all, setAll] = useState(false)
  const Icon = tone === "fixed" ? CheckCircle : XCircle
  const shown = all ? flips : flips.slice(0, SHOWN)
  if (!flips.length) {
    return (
      <p className="min-w-0 text-[13px] text-muted-foreground [&+&]:mt-6 [&+&]:border-t [&+&]:border-border [&+&]:pt-5">
        {tone === "fixed" ? "Fixed nothing" : "Broke nothing"}
      </p>
    )
  }
  return (
    <div className="min-w-0 [&+&]:mt-6 [&+&]:border-t [&+&]:border-border [&+&]:pt-5">
      <h4 className="flex items-center gap-2 text-[15px] font-semibold text-mm-dark">
        <Icon weight="fill" className={cn("size-[18px] shrink-0", tone === "fixed" ? "text-[#2f7a1f] dark:text-[#7cc46a]" : "text-[#b34800] dark:text-[#f08a4b]")} aria-hidden />
        {title} <span className="font-data font-normal text-muted-foreground">{flips.length}</span>
      </h4>
      {
        <ul className="mt-2 divide-y divide-border">
          {shown.map((f) => (
            <li key={f.task_id} className="py-2.5">
              <p className="truncate text-[13px] text-mm-dark" title={f.question}>
                {f.question || f.task_id}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                <span className="flex min-w-0 flex-1 basis-[16rem] items-center gap-1.5 font-data text-muted-foreground">
                  <span className="min-w-0 max-w-[48%] truncate" title={`${before}: ${f.a_answer ?? "no answer"}`}>
                    {f.a_answer ?? "no answer"}
                  </span>
                  <ArrowRight className="size-3 shrink-0" aria-label="then" />
                  <span className="min-w-0 max-w-[48%] truncate text-mm-dark" title={`${after}: ${f.b_answer ?? "no answer"}`}>
                    {f.b_answer ?? "no answer"}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 gap-3">
                  {f.a_run_id ? (
                    <Link href={`/runs/${f.a_run_id}`} className={link}>
                      Before trace
                    </Link>
                  ) : null}
                  {f.b_run_id ? (
                    <Link href={`/runs/${f.b_run_id}`} className={link}>
                      After trace
                    </Link>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      }
      {flips.length > SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={cn("mt-2 text-[12px]", link)}>
          {all ? "Show fewer" : `Show all ${flips.length}`}
        </button>
      ) : null}
    </div>
  )
}

/* ── Problems to look into ─────────────────────────────────────────────── */

/** A problem as one big figure and a few words, plus who and where. */
function headline(p: LabProblem): { big: string; words: string; who: string; lead: string } {
  const where = task(p.benchmark_id)
  let m: RegExpMatchArray | null
  if (p.kind === "failures" && (m = p.title.match(/^(.*) got (\d+) of (\d+) /))) {
    return { big: `${m[2]} of ${m[3]}`, words: "wrong", who: m[1], lead: `${m[1]} is getting ${where} ${taskNoun(p.benchmark_id, 2)} wrong` }
  }
  if (p.kind === "flaky" && (m = p.title.match(/^(.*) gave different results on (\d+) /))) {
    return { big: m[2], words: "inconsistent", who: m[1], lead: `${m[1]} gives different answers when asked again` }
  }
  if (p.kind === "too-close") {
    return { big: "Too close", words: "to call", who: "Single vs multi-agent", lead: `Single vs multi-agent on ${where} isn’t settled` }
  }
  if (p.kind === "unfinished" && (m = p.title.match(/^(.*) on .+?: (\d+ of \d+) (.+)$/))) {
    return { big: m[2], words: m[3], who: m[1], lead: `${m[1]} didn’t finish on ${where}` }
  }
  const lead = p.title.replace(/\.$/, "")
  return { big: p.kind === "unfinished" ? "Unfinished" : "Look", words: "", who: "", lead }
}

/** With nothing chosen, the most important problem leads. */
function ProblemLead({ p, onOpen }: { p: LabProblem; onOpen: () => void }) {
  const h = headline(p)
  return (
    <div>
      <RedTab />
      <h3 className="mt-3.5 text-[15px] font-semibold leading-snug text-muted-foreground text-balance" title={p.title}>
        {h.lead}
      </h3>
      <p className="mt-3 tabular-nums text-[64px] font-semibold leading-[0.95] tracking-[-0.03em] text-mm-dark sm:text-[88px]">
        {h.big}
        {h.words ? <span className="ml-3 text-[22px] font-normal tracking-normal text-muted-foreground sm:text-[28px]">{h.words}</span> : null}
      </p>
      <p className="mt-4 text-[15px] text-muted-foreground">{p.detail}</p>
      <button type="button" onClick={onOpen} className={cn(btnPrimary, "mt-5 cursor-pointer gap-1.5", focusRing)}>
        Look into it
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

const FIRST = 3

function Problems({
  state,
  items,
  current,
  onOpen,
}: {
  state: { error?: string; loading: boolean; retry: () => void }
  items: LabProblem[]
  current: string | null
  onOpen: (p: LabProblem) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, FIRST)
  return (
    <section className="lg:mt-5" aria-labelledby="problems-title">
      <h3 id="problems-title" className="mb-1.5 text-[15px] font-semibold text-mm-dark">
        Problems to look into
      </h3>
      {state.loading ? (
        <div aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-t border-border py-[18px]">
              <div className="h-7 w-40 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3.5 w-56 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : state.error ? (
        <ErrorLine what="The problems" message={state.error} onRetry={state.retry} />
      ) : items.length ? (
        <ul className="border-b border-border">
          {shown.map((p, i) => {
            const h = headline(p)
            const here = !!current && !!p.batch_id && (current === `${p.other_batch_id}|${p.batch_id}` || current.endsWith(`|${p.batch_id}`))
            return (
              <li key={`${p.kind}-${p.batch_id ?? p.benchmark_id}-${i}`}>
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  title={`${p.title}. ${p.detail}`}
                  aria-label={`${p.title}. Look into it`}
                  aria-current={here || undefined}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-4 border-t border-border py-[18px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0265ff]/40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate tabular-nums text-[30px] font-semibold leading-tight tracking-[-0.01em] text-mm-dark group-hover:text-[#0265ff] dark:group-hover:text-[#5b9bff]">
                      {h.big}
                      {h.words ? <span className="ml-2 text-[18px] font-normal tracking-normal text-muted-foreground">{h.words}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                      {[h.who, task(p.benchmark_id)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {here ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">Showing</span>
                  ) : (
                    <CaretRight weight="bold" className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="border-t border-border py-[18px] text-[13px] text-muted-foreground">Nothing else to look into.</p>
      )}
      {items.length > FIRST ? (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={cn("mt-3 text-[13px]", quietLink)}>
          {all ? "Show fewer" : `Show all (${items.length})`}
        </button>
      ) : null}
    </section>
  )
}

/* ── How steady a setup is ─────────────────────────────────────────────── */

/** The after run's setup across all its runs: separate runs of exactly the same setup pool
 *  like passes of one run. Any change to the setup starts a new one, so nothing here mixes
 *  a real change in with run-to-run noise. */
function Steadiness({ s, bench }: { s: LabSteadiness; bench: string }) {
  const [all, setAll] = useState(false)
  const runs = s.runs.length
  const tries = s.tries_per_question
  const across = runs > 1 ? `${runs} runs` : `${s.runs[0]?.passes ?? 1} passes`
  const figure = (n: number, words: string, title: string) => (
    <p className="min-w-0" title={title}>
      <span className="block text-[30px] font-semibold leading-tight tracking-[-0.01em] tabular-nums text-mm-dark">{n}</span>
      <span className="block text-[13px] text-muted-foreground">{words}</span>
    </p>
  )
  const shown = all ? s.mixed : s.mixed.slice(0, SHOWN)
  return (
    <section className={cn("mt-4 px-5 py-6 sm:px-8 sm:py-7", surface)} aria-labelledby="steady-title">
      <h4 id="steady-title" className="text-[15px] font-semibold text-mm-dark">
        How steady {s.configuration_name} is
      </h4>
      {s.questions === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          One try per question so far. Run this setup again on the same questions, or with 3 passes, to see it.
        </p>
      ) : (
        <>
          <p
            className="mt-1 text-[13px] text-muted-foreground"
            title={s.runs.map((r) => `${day(r.created_at)}: ${pct(r.accuracy, 0)}${r.passes > 1 ? `, ${r.passes} passes` : ""}`).join("\n")}
          >
            Across {across} of the same setup · {s.questions} {taskNoun(bench, s.questions)} tried{" "}
            {tries && tries.min === tries.max ? `${tries.min} times each` : tries ? `${tries.min}\u2013${tries.max} times` : ""}
            {s.pass_hat_3 != null ? ` · ${pct(s.pass_hat_3, 0)} chance three tries are all right` : ""}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-4 sm:max-w-[520px]">
            {figure(s.always_right, "right every time", "Right on every try")}
            {figure(s.sometimes, "right sometimes", "Right on some tries, wrong on others")}
            {figure(s.never_right, "never right", "Wrong on every try")}
          </div>
          {s.mixed.length ? (
            <ul className="mt-6 divide-y divide-border border-t border-border">
              {shown.map((m) => (
                <li key={m.task_id} className="flex items-baseline gap-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-mm-dark" title={m.question ?? m.task_id}>
                    {m.question || m.task_id}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    right {m.right} of {m.tries}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {s.mixed.length > SHOWN ? (
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className={cn("mt-2 text-[12px]", link)}>
              {all ? "Show fewer" : `Show all ${s.mixed.length}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}
