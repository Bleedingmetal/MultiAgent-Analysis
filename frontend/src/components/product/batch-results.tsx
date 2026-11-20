"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  CircleHalf,
  CircleNotch,
  MagnifyingGlass,
  MinusCircle,
  Stop,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react"

import {
  type BatchItem,
  type BatchItemStatus,
  type BatchRun,
  type RunResult,
  chainSteps,
  getRun,
  isConversational,
  pipelineSteps,
  taskNoun,
  primaryAccuracy,
} from "@/lib/api"
import { ChainTraceView } from "@/components/product/chain-trace"
import { ConversationView } from "@/components/product/conversation-view"
import { FabRubric } from "@/components/product/fab-rubric"
import { FinQAReasoningComparisonView } from "@/components/product/finqa-reasoning-comparison"
import { RunTrace } from "@/components/product/run-trace"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PAGE = 40

type Filter = "all" | "passed" | "failed" | "mixed" | "error"

export const STATUS_STYLE: Record<
  BatchItemStatus,
  { label: string; cell: string; text: string }
> = {
  passed: { label: "Pass", cell: "bg-mm-green", text: "text-[#2f7a1f]" },
  failed: { label: "Fail", cell: "bg-mm-orange", text: "text-[#b34800]" },
  mixed: { label: "Mixed", cell: "bg-mm-yellow", text: "text-[#7a5d00]" },
  error: { label: "Error", cell: "bg-[#8a94a6]", text: "text-[#5b6577]" },
  unscored: { label: "Unscored", cell: "bg-mm-light", text: "text-mm-blue" },
  running: { label: "Running", cell: "bg-mm-charge animate-pulse", text: "text-mm-charge" },
  pending: { label: "Pending", cell: "bg-[#dfe5ee]", text: "text-muted-foreground" },
  skipped: { label: "Skipped", cell: "bg-[#eef1f6]", text: "text-muted-foreground" },
}

export const BATCH_STATUS_LABEL: Record<BatchRun["status"], string> = {
  running: "Running",
  paused: "Paused for budget",
  completed: "Completed",
  stopped: "Stopped early",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  failed: "Failed",
}

export function usd(value?: number | null) {
  if (value == null) return "—"
  if (value === 0) return "$0"
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(value < 1 ? 3 : 2)}`
}

export function pct(value?: number | null, digits = 1) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`
}

export function secs(value?: number | null) {
  if (value == null) return "—"
  if (value < 60) return `${value.toFixed(1)}s`
  const whole = Math.round(value)
  return `${Math.floor(whole / 60)}m ${whole % 60}s`
}

export function when(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}

function StatusIcon({ status }: { status: BatchItemStatus }) {
  const cls = cn("size-[18px] shrink-0", STATUS_STYLE[status].text)
  switch (status) {
    case "passed":
      return <CheckCircle className={cls} weight="fill" />
    case "failed":
      return <XCircle className={cls} weight="fill" />
    case "error":
      return <WarningCircle className={cls} weight="fill" />
    case "mixed":
      return <CircleHalf className={cls} weight="fill" />
    case "running":
      return <CircleNotch className={cn(cls, "animate-spin")} weight="bold" />
    default:
      return <MinusCircle className={cls} />
  }
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 font-data text-[22px] leading-none tracking-tight text-mm-dark">{value}</dd>
      {hint ? <dd className="mt-1.5 text-[12px] text-muted-foreground">{hint}</dd> : null}
    </div>
  )
}

/** One square per question, coloured by outcome. Click a square to open that question. */
function OutcomeStrip({
  items,
  onPick,
}: {
  items: BatchItem[]
  onPick: (index: number) => void
}) {
  const dense = items.length > 300
  return (
    <div className={cn("flex flex-wrap", dense ? "gap-[2px]" : "gap-[3px]")}>
      {items.map((item) => (
        <button
          key={item.index}
          type="button"
          title={`#${item.index + 1} · ${STATUS_STYLE[item.status].label}`}
          aria-label={`Question ${item.index + 1}: ${STATUS_STYLE[item.status].label}`}
          onClick={() => onPick(item.index)}
          className={cn(
            "rounded-[2px] transition-transform hover:scale-150",
            dense ? "size-[7px]" : "size-[11px]",
            STATUS_STYLE[item.status].cell,
          )}
        />
      ))}
    </div>
  )
}

/** One row per full pass, one square per question: flaky questions show as mixed columns. */
function PassMatrix({ batch, onPick }: { batch: BatchRun; onPick: (index: number) => void }) {
  const per = batch.summary.per_pass ?? []
  const dense = batch.items.length > 120
  return (
    <div className="space-y-1.5">
      {per.map((p) => (
        <div key={p.pass_index} className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-[12px] text-muted-foreground">Pass {p.pass_index + 1}</span>
          <div className={cn("flex min-w-0 flex-1 flex-wrap", dense ? "gap-[2px]" : "gap-[3px]")}>
            {batch.items.map((item) => {
              const a = item.attempts?.find((x) => x.pass_index === p.pass_index)
              const status: BatchItemStatus = a
                ? a.status
                : item.status === "skipped"
                  ? "skipped"
                  : item.status === "running" && p.done < batch.items.length
                    ? "pending"
                    : "pending"
              return (
                <button
                  key={item.index}
                  type="button"
                  title={`Pass ${p.pass_index + 1} · #${item.index + 1} · ${STATUS_STYLE[status].label}${a?.scored_answer ? ` · ${a.scored_answer}` : ""}`}
                  aria-label={`Pass ${p.pass_index + 1}, question ${item.index + 1}: ${STATUS_STYLE[status].label}`}
                  onClick={() => onPick(item.index)}
                  className={cn(
                    "rounded-[2px] transition-transform hover:scale-150",
                    dense ? "size-[7px]" : "size-[11px]",
                    STATUS_STYLE[status].cell,
                  )}
                />
              )
            })}
          </div>
          <span className="w-[13rem] shrink-0 text-right font-data text-[12px] text-muted-foreground">
            {p.done ? `${pct(p.pass_rate, 0)} · ${usd(p.cost_usd)} · ${secs(p.avg_latency_sec)}` : "not started"}
          </span>
        </div>
      ))}
    </div>
  )
}

function ItemDetail({ item }: { item: BatchItem }) {
  const attempts = item.attempts ?? []
  const [which, setWhich] = useState(0)
  const attempt = attempts[which]
  const runId = attempts.length ? attempt?.run_id : item.run_id
  const [run, setRun] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRun(null)
    setError(null)
    if (!runId) return
    let cancelled = false
    getRun(runId)
      .then((r) => !cancelled && setRun(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load run"))
    return () => {
      cancelled = true
    }
  }, [runId])

  const picker =
    attempts.length > 1 ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-muted-foreground">Pass</span>
        {attempts.map((a, i) => {
          const answer = a.scored_answer?.trim()
          return (
            <button
              key={a.pass_index}
              type="button"
              onClick={() => setWhich(i)}
              title={answer || STATUS_STYLE[a.status].label}
              aria-pressed={i === which}
              className={cn(
                "inline-flex h-7 max-w-[13rem] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium",
                i === which ? "border-mm-dark bg-mm-dark text-white" : "border-border/80 bg-white text-mm-dark hover:bg-[#f4f7fb]",
              )}
            >
              <span className="shrink-0 tabular-nums">{a.pass_index + 1}</span>
              <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_STYLE[a.status].cell)} />
              <span className={cn("min-w-0 truncate", answer && answer.length <= 24 && "font-data")}>
                {answer || STATUS_STYLE[a.status].label}
              </span>
            </button>
          )
        })}
      </div>
    ) : null

  if (!runId) {
    return (
      <p className="text-[13px] text-[#5b6577]">
        {item.error ??
          (item.status === "skipped" ? "Not run: the batch stopped first." : "Not run yet.")}
      </p>
    )
  }
  if (error) return <p className="text-[13px] text-[#b34800]">{error}</p>
  if (!run) {
    return (
      <div className="space-y-3">
        {picker}
        <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          <CircleNotch className="size-4 animate-spin" /> Loading trace…
        </p>
      </div>
    )
  }

  const chain = chainSteps(run)
  const pipeline = pipelineSteps(run)
  if (run.conversation) {
    return (
      <div className="space-y-4">
        {picker}
        {run.note ? <p className="text-[13px] leading-relaxed text-muted-foreground">{run.note}</p> : null}
        {run.error ? (
          <p className="rounded-xl border border-mm-orange/25 bg-mm-orange/8 px-4 py-3 text-[13px] text-[#b34800]">
            {run.error}
          </p>
        ) : null}
        <ConversationView run={run} compact />
        {pipeline.length ? <RunTrace steps={pipeline} /> : null}
        <Link
          href={`/runs/${run.id}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-charge hover:underline"
        >
          Open full run <ArrowSquareOut className="size-3.5" weight="bold" />
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {picker}
      {run.benchmark_id === "fab" ? (
        <>
          <div className="rounded-xl bg-[#f4f7fb] px-4 py-3">
            <p className="text-[12px] font-medium text-muted-foreground">Agent answer</p>
            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-mm-dark">
              {run.scored_answer || run.answer || "No final answer"}
            </p>
          </div>
          <FabRubric run={run} />
        </>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#f4f7fb] px-4 py-3">
          <p className="text-[12px] font-medium text-muted-foreground">Agent answer</p>
          <p className="mt-1.5 text-[14px] text-mm-dark">
            {run.scored_answer || "No final answer"}
          </p>
        </div>
        <div className="rounded-xl bg-[#f4f7fb] px-4 py-3">
          <p className="text-[12px] font-medium text-muted-foreground">Expected</p>
          <p className="mt-1.5 text-[14px] text-mm-dark">
            {run.expected_display ?? run.expected_answer ?? "—"}
            {run.expected_display &&
            run.expected_answer &&
            run.expected_display !== run.expected_answer ? (
              <span className="mt-1 block text-[12px] text-muted-foreground">
                FinQA program result {run.expected_answer}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      )}

      {(run.label_disputed || run.note?.includes("cut off")) && run.note ? (
        <p className="rounded-xl border border-mm-yellow/40 bg-mm-yellow/10 px-4 py-3 text-[13px] text-[#5c4600]">
          {run.note}
        </p>
      ) : null}

      {run.error ? (
        <p className="rounded-xl border border-mm-orange/25 bg-mm-orange/8 px-4 py-3 text-[13px] text-[#b34800]">
          {run.error}
        </p>
      ) : null}

      {chain.length ? <ChainTraceView steps={chain} /> : null}
      {pipeline.length ? <RunTrace steps={pipeline} /> : null}

      {run.reasoning_comparison ? (
        <FinQAReasoningComparisonView
          comparison={run.reasoning_comparison}
          agentReasoning={run.reasoning}
        />
      ) : null}

      <Link
        href={`/runs/${run.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-charge hover:underline"
      >
        Open full run <ArrowSquareOut className="size-3.5" weight="bold" />
      </Link>
    </div>
  )
}

function ItemRow({
  item,
  open,
  onToggle,
}: {
  item: BatchItem
  open: boolean
  onToggle: () => void
}) {
  const attempts = item.attempts ?? []
  const multi = attempts.length > 1 || (item.passes_passed ?? 0) + (item.passes_failed ?? 0) > 1
  return (
    <li
      id={`batch-item-${item.index}`}
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        open ? "border-mm-charge/30" : "border-border/70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <StatusIcon status={item.status} />
        <span className="w-9 shrink-0 font-data text-[11px] leading-[18px] text-muted-foreground">
          #{item.index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13.5px] leading-snug text-mm-dark">
            {item.question}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 font-data text-[11px] text-muted-foreground">
            {item.expected_display != null || item.scored_answer != null ? (
              <>
                <span className="max-w-[28ch] truncate" title={item.scored_answer ?? undefined}>
                  got{" "}
                  <span className={STATUS_STYLE[item.status].text}>
                    {item.scored_answer ?? "—"}
                  </span>
                </span>
                <span>expected {item.expected_display ?? "—"}</span>
              </>
            ) : (
              <span className={STATUS_STYLE[item.status].text}>{STATUS_STYLE[item.status].label}</span>
            )}
            {multi ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex gap-[2px]" aria-hidden>
                  {attempts.map((a) => (
                    <span key={a.pass_index} className={cn("size-[7px] rounded-[1px]", STATUS_STYLE[a.status].cell)} />
                  ))}
                </span>
                right in {item.passes_passed ?? 0} of {attempts.length} passes
              </span>
            ) : null}
            {item.label_disputed ? (
              <span
                className="rounded-full bg-mm-yellow/20 px-1.5 text-[#7a5d00]"
                title="FinQA's gold program and its own step annotation disagree; either answer is accepted"
              >
                disputed label
              </span>
            ) : null}
          </span>
        </span>
        <span className="hidden shrink-0 text-right font-data text-[11px] leading-[18px] text-muted-foreground sm:block">
          {item.run_id ? `${usd(item.cost_usd)} · ${secs(item.latency_sec)}` : ""}
        </span>
        <CaretDown
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          weight="bold"
        />
      </button>
      {open ? (
        <div className="border-t border-border/70 px-4 py-4">
          <ItemDetail item={item} />
        </div>
      ) : null}
    </li>
  )
}

/** Headline, outcome strip, metrics, and the per-question list for one end-to-end run. */
export function BatchResults({
  batch,
  onStop,
  onContinue,
  showMeta = true,
  children,
}: {
  batch: BatchRun
  onStop?: () => void
  /** Continue past the budget check (the cap rises to the projected total). */
  onContinue?: () => void
  showMeta?: boolean
  /** Rendered between the headline metrics and the question list. */
  children?: React.ReactNode
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const conv = isConversational(batch.benchmark_id)
  const noun = (n: number) => taskNoun(batch.benchmark_id, n)
  // A FinQA pass is a correct answer; a τ-bench pass is a completed conversation
  const unit = (n: number) => (passes > 1 ? (conv ? "results" : "answers") : noun(n))
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const pendingScroll = useRef<number | null>(null)

  // Reset the list when a different batch is shown.
  useEffect(() => {
    setFilter("all")
    setQuery("")
    setShown(PAGE)
    setOpenIndex(null)
  }, [batch.id])

  const counts = useMemo(
    () => ({
      all: batch.items.length,
      passed: batch.items.filter((i) => i.status === "passed").length,
      failed: batch.items.filter((i) => i.status === "failed").length,
      mixed: batch.items.filter((i) => i.status === "mixed").length,
      error: batch.items.filter((i) => i.status === "error").length,
    }),
    [batch],
  )
  const passes = batch.passes ?? 1

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return batch.items.filter(
      (i) =>
        (filter === "all" || i.status === filter) &&
        (!q || i.question.toLowerCase().includes(q) || i.task_id.toLowerCase().includes(q)),
    )
  }, [batch, filter, query])

  // Clicking a square: switch to "All", page far enough, open it, then scroll to it.
  function pick(index: number) {
    setFilter("all")
    setQuery("")
    setShown((s) => Math.max(s, index + 1))
    setOpenIndex(index)
    pendingScroll.current = index
  }

  useEffect(() => {
    if (pendingScroll.current == null) return
    const el = document.getElementById(`batch-item-${pendingScroll.current}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      pendingScroll.current = null
    }
  })

  const s = batch.summary
  const running = batch.status === "running"
  const paused = batch.status === "paused"
  const progress = (s.attempts_total ?? s.total) ? (s.attempts_done ?? s.done) / (s.attempts_total ?? s.total) : 0

  return (
    <div className="space-y-5">
      {paused ? (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-mm-yellow/50 bg-mm-yellow/10 px-5 py-4">
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-[#5c4600]">
            <span className="font-semibold">Stopped before going over budget.</span>{" "}
            {batch.stop_reason}
            {s.projected_cost_usd != null ? (
              <span className="block text-[12px] text-[#7a5d00]">
                Continuing raises this run&apos;s cap to {usd(s.projected_cost_usd * 2)} (double the projection) so it can finish; the daily budget still applies.
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 gap-2">
            {onContinue ? (
              <Button type="button" onClick={onContinue} className="h-10 rounded-full bg-mm-dark px-4 text-sm text-white hover:bg-black">
                Continue
              </Button>
            ) : null}
            {onStop ? (
              <Button type="button" variant="outline" onClick={onStop} className="h-10 rounded-full px-4 text-sm">
                <Stop className="size-4" weight="fill" />
                Stop here
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {showMeta ? (
            <p className="font-data text-[11px] tracking-wide text-mm-blue">
              <Link href={`/runs/e2e/${batch.id}`} className="hover:underline">
                {batch.id}
              </Link>{" "}
              · {when(batch.created_at)} · {batch.models.join(", ") || batch.mode}
            </p>
          ) : null}
          <div className="mt-2 flex items-baseline gap-3">
            <p className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-mm-dark">
              {pct(primaryAccuracy(s), 1)}
            </p>
            {s.mean_score != null ? (
              <p className="text-[13px] text-muted-foreground">
                partial credit{passes > 1 ? ` over ${passes} full passes` : ""} · all criteria met in {s.passed} of{" "}
                {s.passed + s.failed} ({pct(s.pass_rate, 0)})
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {passes > 1 ? `mean pass rate over ${passes} full passes` : "pass rate"} · {s.passed} of{" "}
                {s.passed + s.failed} {unit(s.passed + s.failed)} {conv ? "completed" : "correct"}
              </p>
            )}
          </div>
          {passes > 1 ? (
            <p className="mt-2 text-[13px] text-mm-dark">
              {s.pass_rate_min != null && s.pass_rate_max != null ? (
                <>
                  Passes ranged{" "}
                  <span className="font-data font-semibold">
                    {pct(s.pass_rate_min, 0)}–{pct(s.pass_rate_max, 0)}
                  </span>
                  {" · "}
                </>
              ) : null}
              right in every pass{" "}
              <span className="font-data font-semibold">{pct(s.pass_all_rate, 0)}</span>
              {" · "}in at least one{" "}
              <span className="font-data font-semibold">{pct(s.pass_any_rate, 0)}</span>
              {s.mixed ? ` · ${s.mixed} ${noun(s.mixed)} flipped between passes` : ""}
            </p>
          ) : null}
          <p className="mt-2 text-[13px] text-muted-foreground">
            <span className={cn("font-medium", running ? "text-mm-charge" : paused ? "text-[#7a5d00]" : "text-mm-dark")}>
              {BATCH_STATUS_LABEL[batch.status]}
            </span>
            {" · "}
            {passes > 1
              ? `pass ${Math.min(passes, (s.per_pass ?? []).filter((p) => p.done > 0).length || 1)} of ${passes} · ${s.attempts_done ?? 0} / ${s.attempts_total ?? s.total * passes} ${conv ? "results" : "answers"}`
              : `${s.done} / ${s.total} ${noun(s.total)}`}{" "}
            · {secs(s.elapsed_sec)}
            {batch.stop_reason && !paused ? ` · ${batch.stop_reason}` : ""}
          </p>
        </div>
        {running && onStop ? (
          <Button
            type="button"
            variant="outline"
            onClick={onStop}
            className="h-10 rounded-full px-4 text-sm"
          >
            <Stop className="size-4" weight="fill" />
            Stop
          </Button>
        ) : null}
      </div>

      {running ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]">
          <div
            className="h-full rounded-full bg-mm-charge transition-[width] duration-500"
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
      ) : null}

      {passes > 1 && s.per_pass?.length ? (
        <PassMatrix batch={batch} onPick={pick} />
      ) : (
        <OutcomeStrip items={batch.items} onPick={pick} />
      )}

      <dl className="grid grid-cols-2 divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-white lg:grid-cols-4 lg:divide-x">
        <Stat
          label="Cost"
          value={usd(s.cost_usd)}
          hint={
            running && s.projected_cost_usd != null
              ? `about ${usd(s.projected_cost_usd)} when done`
              : `${usd(s.avg_cost_usd)} per ${conv ? "conversation" : passes > 1 ? "answer" : "question"}`
          }
        />
        <Stat
          label={conv ? "Per completed conversation" : "Per correct answer"}
          value={usd(s.cost_per_pass_usd)}
          hint={conv ? "cost ÷ conversations that passed" : "cost ÷ correct answers"}
        />
        <Stat
          label={`Time per ${noun(1)}`}
          value={secs(s.avg_latency_sec)}
          hint={s.p95_latency_sec != null ? `slowest tenth ${secs(s.p95_latency_sec)}` : undefined}
        />
        {conv ? (
          <Stat
            label="Did not finish"
            value={String(s.errors)}
            hint={s.errors ? "stopped before the grader ran" : "every conversation reached the grader"}
          />
        ) : (
          <Stat
            label="Calculation matched FinQA"
            value={pct(s.program_match_rate, 0)}
            hint={s.errors ? `${s.errors} errored` : "of answers with a program"}
          />
        )}
      </dl>

      {children}

      <div>
        <h2 className="mb-3 text-[16px] font-semibold text-mm-dark">{noun(2).replace(/^./, (c) => c.toUpperCase())}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="seg-track">
            {(
              [
                ["all", "All"],
                ["passed", "Passed"],
                ["failed", "Failed"],
                ["mixed", "Mixed"],
                ["error", "Errors"],
              ] as const
            )
              .filter(([id]) => id !== "mixed" || passes > 1)
              .map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="seg-item"
                data-active={filter === id}
                onClick={() => {
                  setFilter(id)
                  setShown(PAGE)
                }}
              >
                {label}
                <span className="ml-1 opacity-50">{counts[id]}</span>
              </button>
            ))}
          </div>
          <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-full border border-border/80 bg-white px-3">
            <MagnifyingGlass className="size-4 text-muted-foreground" weight="bold" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun(2)}`}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </label>
        </div>

        {visible.length ? (
          <ul className="space-y-2">
            {visible.slice(0, shown).map((item) => (
              <ItemRow
                key={item.index}
                item={item}
                open={openIndex === item.index}
                onToggle={() =>
                  setOpenIndex((current) => (current === item.index ? null : item.index))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No {noun(2)} match.
          </p>
        )}
        {visible.length > shown ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShown((v) => v + PAGE)}
            className="mt-3 h-9 w-full rounded-full text-sm"
          >
            Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
