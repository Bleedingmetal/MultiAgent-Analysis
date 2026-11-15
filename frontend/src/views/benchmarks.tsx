"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type React from "react"
import { ArrowUpRight } from "@phosphor-icons/react"

import { IslandLink, Reveal, RevealInView } from "@/components/product/ui-bits"
import { benchmarks, taskRegimes } from "@/data/evaluation-mock"
import { type BenchmarkInfo, getDatasets } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Phone, Plot, Relay, Terminal } from "@lucasmarkes/hairline/react"

// One hairline figure per benchmark: an isometric line object that answers the pointer.
// FinQA is a bar chart whose tabs lift; τ-bench a phone that opens in layers (a customer
// call); τ²-bench a relay whose path lights hop by hop (a tool-calling conversation);
// FAB a terminal with its history (research over filings).
const FIGURE: Record<string, React.ComponentType<{ play?: boolean; intensity?: number; theme?: "auto" | "light" | "dark"; label?: string; className?: string }>> = {
  finqa: Plot,
  "tau-retail": Phone,
  "tau2-retail": Relay,
  fab: Terminal,
}
const FIGURE_STYLE = {
  "--hairline-plate": "#001735",
  "--hairline-hi": "#ffffff",
  "--hairline-edge": "#9fc2ef",
  "--hairline-mid": "#4a74a8",
  "--hairline-lo": "#0b2a55",
} as React.CSSProperties

export default function Benchmarks() {
  const [live, setLive] = useState<Record<string, BenchmarkInfo> | null>(null)
  const [apiDown, setApiDown] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDatasets()
      .then((res) => {
        if (cancelled) return
        setLive(Object.fromEntries(res.benchmarks.map((b) => [b.id, b])))
      })
      .catch(() => !cancelled && setApiDown(true))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
            Benchmarks
          </h2>
        </div>
        <IslandLink href="/compare">Compare</IslandLink>
      </Reveal>

      <div className="grid gap-4">
        {benchmarks.map((bench, index) => {
          const regime = taskRegimes.find((r) => r.id === bench.regimeId)
          const info = live?.[bench.id]
          const ready = !!info && (info.available ?? info.task_count > 0)
          return (
            <RevealInView key={bench.id} delay={index * 0.05}>
              <article className="surface-interactive grid overflow-hidden md:grid-cols-[1.4fr_0.9fr]">
                <div className="border-b border-border/70 p-6 md:border-b-0 md:border-r">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-mm-charge/10 px-2.5 py-0.5 text-[11px] font-medium text-mm-charge">
                      {bench.role}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {bench.structure}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[22px] font-semibold tracking-tight text-mm-dark">
                    {bench.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {bench.description}
                  </p>
                  <p className="mt-5 text-sm text-mm-dark">
                    Checker: {bench.checker}
                  </p>
                  {/* What the backend actually has on disk for this benchmark */}
                  <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-4 font-data text-[12px]">
                    <div>
                      <dt className="text-muted-foreground">Tasks</dt>
                      <dd className="mt-0.5 text-mm-dark">
                        {info ? info.task_count.toLocaleString() : apiDown ? "—" : "…"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Scoring</dt>
                      <dd className="mt-0.5 text-mm-dark">
                        {info ? (info.scored ? "automatic pass / fail" : "not auto-scored") : apiDown ? "—" : "…"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="mt-0.5 inline-flex items-center gap-1.5 text-mm-dark">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            ready ? "bg-mm-green" : live || apiDown ? "bg-mm-orange" : "bg-[#dfe5ee]",
                          )}
                        />
                        {ready
                          ? "ready to run"
                          : apiDown
                            ? "backend offline"
                            : live
                              ? "data not installed"
                              : "checking"}
                      </dd>
                    </div>
                  </dl>
                  {info?.notes ? (
                    <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{info.notes}</p>
                  ) : null}
                </div>
                <div className="bg-mm-dark p-6 text-white">
                  {FIGURE[bench.id] ? (
                    <div className="mb-5" style={FIGURE_STYLE}>
                      {(() => {
                        const Figure = FIGURE[bench.id]
                        return <Figure play intensity={0.6} theme="dark" label={`${bench.name} figure`} />
                      })()}
                    </div>
                  ) : null}
                  <p className="text-[12px] text-mm-light/80">
                    Example use case
                  </p>
                  <p className="mt-2 text-[18px] font-semibold leading-snug tracking-tight">
                    {regime?.enterpriseExample}
                  </p>
                  <p className="mt-4 text-sm text-white/65">
                    Priority: {regime?.priority}
                  </p>
                  <p className="mt-3 text-[12px] leading-relaxed text-white/45">
                    {regime?.priorityDetail}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
                    <Link
                      href={`/compare?benchmark=${bench.id}`}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-light hover:text-white"
                    >
                      Rank architectures
                      <ArrowUpRight className="size-3.5" weight="bold" />
                    </Link>
                    {ready ? (
                      <Link
                        href="/configurations"
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/70 hover:text-white"
                      >
                        Run a configuration on it
                        <ArrowUpRight className="size-3.5" weight="bold" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            </RevealInView>
          )
        })}
      </div>
    </div>
  )
}
