"use client"

import Link from "next/link"
import { ArrowUpRight } from "@phosphor-icons/react"

import { IslandLink, Reveal, RevealInView } from "@/components/product/ui-bits"
import { benchmarks, taskRegimes } from "@/data/evaluation-mock"

export default function Benchmarks() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-mm-dark md:text-[38px]">
            Benchmarks
          </h2>
          <p className="mt-2 max-w-[42ch] text-[15px] text-muted-foreground">
            Task sets that force different architecture tradeoffs.
          </p>
        </div>
        <IslandLink href="/compare">Compare</IslandLink>
      </Reveal>

      <div className="grid gap-4">
        {benchmarks.map((bench, index) => {
          const regime = taskRegimes.find((r) => r.id === bench.regimeId)
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
                </div>
                <div className="bg-gradient-to-br from-mm-dark to-[#002a5c] p-6 text-white">
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
                  <Link
                    href={`/compare?benchmark=${bench.id}`}
                    className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-mm-light hover:text-white"
                  >
                    Rank architectures
                    <ArrowUpRight className="size-3.5" weight="bold" />
                  </Link>
                </div>
              </article>
            </RevealInView>
          )
        })}
      </div>
    </div>
  )
}
