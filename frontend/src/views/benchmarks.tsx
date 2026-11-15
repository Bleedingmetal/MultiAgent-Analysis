"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type React from "react"
import { ArrowUpRight } from "@phosphor-icons/react"

import { IslandLink, Reveal, RevealInView } from "@/components/product/ui-bits"
import { benchmarks, taskRegimes } from "@/data/evaluation-mock"
import { type BenchmarkInfo, getDatasets } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Drawer, Plot } from "@lucasmarkes/hairline/react"

import { HairlineDesk } from "@/components/product/hairline-desk"

type Figure = React.ComponentType<{
  play?: boolean
  intensity?: number
  theme?: "auto" | "light" | "dark"
  label?: string
  className?: string
}>

// One hairline figure per benchmark, a scene from what the benchmark tests. The two τ benchmarks
// are customer support, so they get our own figure: an agent at the counter who turns to you,
// leans in and picks up the handset. The label is for screen readers; nothing is captioned.
const FIGURE: Record<string, { Figure: Figure; label: string }> = {
  "tau-retail": { Figure: HairlineDesk, label: "A support agent at the counter answering a customer's call" },
  "tau2-retail": { Figure: HairlineDesk, label: "A support agent at the counter answering a customer's call" },
  finqa: { Figure: Plot, label: "Figures pulled from a company's filing" },
  fab: { Figure: Drawer, label: "Filings pulled from the cabinet for a research question" },
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
          const figure = FIGURE[bench.id]
          return (
            <RevealInView key={bench.id} delay={index * 0.05}>
              <article className="surface-interactive grid overflow-hidden md:grid-cols-[1.4fr_0.9fr]">
                {/* Everything to read is in this column; its height sets the card's */}
                <div className="flex flex-col gap-5 p-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-mm-charge/10 px-2.5 py-0.5 text-[11px] font-medium text-mm-charge">
                        {bench.role}
                      </span>
                      <span className="text-[12px] text-muted-foreground">{bench.structure}</span>
                    </div>
                    <h3 className="mt-4 text-[22px] font-semibold tracking-tight text-mm-dark">{bench.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{bench.description}</p>
                    <p className="mt-4 text-sm text-mm-dark">Checker: {bench.checker}</p>
                  </div>

                  {regime ? (
                    <div className="rounded-xl bg-muted/60 px-4 py-3">
                      <p className="text-[12px] text-muted-foreground">Example use case</p>
                      <p className="mt-0.5 text-[15px] font-semibold text-mm-dark">{regime.enterpriseExample}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        Priority: {regime.priority}. {regime.priorityDetail}
                      </p>
                    </div>
                  ) : null}

                  <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-4 font-data text-[12px]">
                    <div>
                      <dt className="text-muted-foreground">Tasks</dt>
                      <dd className="mt-0.5 text-mm-dark">{info ? info.task_count.toLocaleString() : apiDown ? "—" : "…"}</dd>
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
                        <span className={cn("size-1.5 rounded-full", ready ? "bg-mm-green" : live || apiDown ? "bg-mm-orange" : "bg-[#dfe5ee]")} />
                        {ready ? "ready to run" : apiDown ? "backend offline" : live ? "data not installed" : "checking"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <Link
                      href={`/compare?benchmark=${bench.id}`}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-charge hover:underline"
                    >
                      Rank architectures
                      <ArrowUpRight className="size-3.5" weight="bold" />
                    </Link>
                    {ready ? (
                      <Link
                        href="/configurations"
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-charge hover:underline"
                      >
                        Run a configuration on it
                        <ArrowUpRight className="size-3.5" weight="bold" />
                      </Link>
                    ) : null}
                  </div>
                </div>

                {/* The scene: a figure that answers the pointer, and what it shows */}
                <div className="flex items-center justify-center bg-mm-dark p-6">
                  {figure ? (
                    <div className="w-full max-w-[340px]" style={FIGURE_STYLE}>
                      <figure.Figure play intensity={0.6} theme="dark" label={figure.label} />
                    </div>
                  ) : null}
                </div>
              </article>
            </RevealInView>
          )
        })}
      </div>
    </div>
  )
}
