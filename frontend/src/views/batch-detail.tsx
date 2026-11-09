"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, DownloadSimple, Play } from "@phosphor-icons/react"

import {
  BatchResults,
  STATUS_STYLE,
  pct,
  secs,
  usd,
  when,
} from "@/components/product/batch-results"
import { Bezel, Reveal } from "@/components/product/ui-bits"
import { Button } from "@/components/ui/button"
import {
  type BatchItem,
  type BatchRun,
  type BenchmarkId,
  type RunMode,
  benchmarkName,
  cancelBatch,
  createBatch,
  getBatch,
  taskNoun,
} from "@/lib/api"
import { getConfiguration } from "@/lib/configuration-storage"
import { cn } from "@/lib/utils"

const POLL_MS = 1500

const MODE_LABEL: Record<string, string> = {
  pipeline: "Pipeline engine",
  "prompt-chain": "Prompt chain runner",
  routing: "Routing runner",
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(batch: BatchRun) {
  const header = [
    "index", "task_id", "status", "question", "expected", "answer",
    "passes_passed", "passes_run", "program_match", "cost_usd", "latency_sec", "run_id", "error",
  ]
  const rows = batch.items.map((i) => [
    i.index + 1, i.task_id, i.status, i.question, i.expected_display, i.scored_answer,
    i.passes_passed ?? (i.status === "passed" ? 1 : 0), i.attempts?.length ?? (i.run_id ? 1 : 0),
    i.program_match, i.cost_usd, i.latency_sec, i.run_id, i.error,
  ])
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `${batch.id}-${batch.configuration_name.replace(/[^\w-]+/g, "_")}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[13.5px] font-medium text-mm-dark [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

function Breakdown({ batch }: { batch: BatchRun }) {
  const s = batch.summary
  const parts = [
    { key: "passed", n: s.passed },
    { key: "failed", n: s.failed },
    { key: "error", n: s.errors },
    { key: "skipped", n: s.skipped },
    { key: "pending", n: Math.max(0, s.total - s.done - s.skipped) },
  ] as const
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[#eef1f6]">
        {parts.map((p) =>
          p.n ? (
            <div
              key={p.key}
              className={cn("h-full", STATUS_STYLE[p.key].cell)}
              style={{ width: `${(p.n / Math.max(1, s.total)) * 100}%` }}
              title={`${STATUS_STYLE[p.key].label}: ${p.n}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
        {parts
          .filter((p) => p.n)
          .map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATUS_STYLE[p.key].cell)} />
              {STATUS_STYLE[p.key].label}
              <span className="font-data text-mm-dark">
                {p.n} · {pct(p.n / Math.max(1, s.total), 0)}
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}

function QuestionLinks({
  title,
  items,
  value,
}: {
  title: string
  items: BatchItem[]
  value: (item: BatchItem) => string
}) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.index} className="flex items-baseline gap-2 text-[13px]">
            <span className="font-data text-[11px] text-muted-foreground">#{item.index + 1}</span>
            {item.run_id ? (
              <Link
                href={`/runs/${item.run_id}`}
                className="min-w-0 flex-1 truncate text-mm-dark hover:text-mm-charge hover:underline"
              >
                {item.question}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-mm-dark">{item.question}</span>
            )}
            <span className="font-data text-[11px] text-muted-foreground">{value(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [batch, setBatch] = useState<BatchRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [configExists, setConfigExists] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getBatch(id)
      .then((b) => {
        if (cancelled) return
        setBatch(b)
        setConfigExists(Boolean(getConfiguration(b.configuration_id)))
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Not found"))
    return () => {
      cancelled = true
    }
  }, [id])

  const running = batch?.status === "running"
  useEffect(() => {
    if (!running || !id) return
    const timer = setInterval(() => {
      getBatch(id).then(setBatch).catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, id])

  const insights = useMemo(() => {
    const finished = (batch?.items ?? []).filter((i) => i.run_id)
    const errors = new Map<string, number>()
    for (const item of batch?.items ?? []) {
      if (item.status !== "error") continue
      const reason = (item.error ?? "Unknown error").split(":")[0].slice(0, 90)
      errors.set(reason, (errors.get(reason) ?? 0) + 1)
    }
    return {
      expensive: [...finished].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 3),
      slowest: [...finished].sort((a, b) => b.latency_sec - a.latency_sec).slice(0, 3),
      errors: [...errors.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [batch])

  async function runAgain() {
    if (!batch?.configuration) return
    setBusy(true)
    setActionError(null)
    try {
      const next = await createBatch({
        configuration: batch.configuration,
        mode: batch.mode as RunMode,
        benchmark_id: batch.benchmark_id as BenchmarkId,
        size: batch.size,
        passes: batch.passes ?? 1,
        budget_usd: batch.budget_usd,
        concurrency: batch.concurrency,
      })
      router.push(`/runs/e2e/${next.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start")
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!batch) return
    try {
      setBatch(await cancelBatch(batch.id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not stop")
    }
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-xl font-semibold text-mm-dark">{error}</h2>
        <Button render={<Link href="/runs" />} variant="outline" className="h-10 rounded-full px-4">
          <ArrowLeft className="size-4" />
          Runs
        </Button>
      </div>
    )
  }
  if (!batch) return <p className="text-sm text-muted-foreground">Loading end-to-end run…</p>

  const s = batch.summary
  const started = new Date(batch.created_at)
  const finished = batch.finished_at ? new Date(batch.finished_at) : null

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal>
        <Link
          href="/runs"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-mm-dark"
        >
          <ArrowLeft className="size-3.5" weight="bold" />
          Back
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-mm-dark md:text-[32px]">
              {batch.configuration_name}
            </h2>
            <p className="mt-2 text-[13px] text-muted-foreground">
              End-to-end run on {benchmarkName(batch.benchmark_id)} · {batch.size.toLocaleString()} {taskNoun(batch.benchmark_id, batch.size)}
              {(batch.passes ?? 1) > 1 ? ` × ${batch.passes} full passes` : ""}
              <span className="mx-2 text-border">/</span>
              <span className="font-data text-[12px]">{batch.id}</span>
              <span className="mx-2 text-border">/</span>
              {when(batch.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {configExists ? (
              <Button
                render={<Link href={`/configurations/${batch.configuration_id}`} />}
                variant="outline"
                className="h-10 rounded-full px-4 text-sm"
              >
                Configuration
                <ArrowRight className="size-3.5" weight="bold" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadCsv(batch)}
              className="h-10 rounded-full px-4 text-sm"
            >
              <DownloadSimple className="size-4" weight="bold" />
              CSV
            </Button>
            <button
              type="button"
              disabled={busy || running || !batch.configuration}
              onClick={() => void runAgain()}
              className="island-cta disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{busy ? "Starting…" : "Run again"}</span>
              <span className="island-cta-icon" aria-hidden>
                <Play className="size-3.5" weight="fill" />
              </span>
            </button>
          </div>
        </div>
        {actionError ? <p className="mt-3 text-sm text-[#b34800]">{actionError}</p> : null}
      </Reveal>

      <Reveal delay={0.05}>
        <Bezel coreClassName="p-5 md:p-6">
          <BatchResults batch={batch} onStop={() => void stop()} showMeta={false}>
            {/* Details: two panels at their own heights, so neither is stretched */}
            <div className="grid items-start gap-4 lg:grid-cols-3">
              <section className="min-w-0 rounded-2xl bg-[#f5f7fb] p-5 lg:col-span-2">
                <h2 className="text-[15px] font-semibold text-mm-dark">Details</h2>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 xl:grid-cols-3">
                  <Field label="Architecture" value={batch.architecture} />
                  <Field label="Runner" value={MODE_LABEL[batch.mode] ?? batch.mode} />
                  <Field label="Models" value={batch.models.join(", ") || "—"} />
                  <Field
                    label={`${taskNoun(batch.benchmark_id, 2).replace(/^./, (c) => c.toUpperCase())} run`}
                    value={`${s.done} of ${s.total}${s.skipped ? ` · ${s.skipped} skipped` : ""}`}
                  />
                  <Field label="Spent" value={`${usd(s.cost_usd)} of ${usd(batch.budget_usd)} cap`} />
                  <Field label="Duration" value={secs(s.elapsed_sec)} />
                  <Field label="Started" value={started.toLocaleString()} />
                  <Field label="Finished" value={finished ? finished.toLocaleString() : "—"} />
                  <Field label="Parallel workers" value={batch.concurrency} />
                  <Field
                    label="Full passes"
                    value={
                      (batch.passes ?? 1) > 1
                        ? `${batch.passes} · every pass ${pct(s.pass_all_rate, 0)} · any pass ${pct(s.pass_any_rate, 0)}`
                        : "1"
                    }
                  />
                  <Field
                    label="Tokens"
                    value={`${s.prompt_tokens.toLocaleString()} in → ${s.completion_tokens.toLocaleString()} out`}
                  />
                  <Field label="Latency p50 / p95" value={`${secs(s.p50_latency_sec)} / ${secs(s.p95_latency_sec)}`} />
                  {batch.benchmark_id === "finqa" ? (
                    <Field
                      label="Disputed labels"
                      value={s.disputed ? `${s.disputed} of ${s.done}` : "None"}
                    />
                  ) : null}
                </dl>
                {batch.stop_reason ? (
                  <p className="mt-5 text-[13px] text-mm-dark">{batch.stop_reason}</p>
                ) : null}
              </section>

              <section className="min-w-0 space-y-5 rounded-2xl bg-[#f5f7fb] p-5">
                <div>
                  <h2 className="text-[15px] font-semibold text-mm-dark">Outcomes</h2>
                  <div className="mt-4">
                    <Breakdown batch={batch} />
                  </div>
                </div>
                {insights.errors.length ? (
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground">Errors by reason</p>
                    <ul className="mt-2 space-y-1 text-[13px]">
                      {insights.errors.map(([reason, count]) => (
                        <li key={reason} className="flex gap-2">
                          <span className="tabular-nums text-[#5b6577]">{count}×</span>
                          <span className="text-mm-dark">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <QuestionLinks
                  title="Most expensive"
                  items={insights.expensive}
                  value={(i) => usd(i.cost_usd)}
                />
                <QuestionLinks
                  title="Slowest"
                  items={insights.slowest}
                  value={(i) => secs(i.latency_sec)}
                />
              </section>
            </div>
          </BatchResults>
        </Bezel>
      </Reveal>
    </div>
  )
}
