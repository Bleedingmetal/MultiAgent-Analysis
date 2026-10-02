import Link from "next/link"

import { ArrowUpRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  benchmarks,
  taskRegimes,
} from "@/data/evaluation-mock"

export default function Benchmarks() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-mm-dark">
          Benchmarks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Task sets used to compare architectures.
        </p>
      </div>

      <div className="grid gap-4">
        {benchmarks.map((bench) => {
          const regime = taskRegimes.find((r) => r.id === bench.regimeId)

          return (
            <div
              key={bench.id}
              className="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-2"
            >
              <div className="border-b border-border p-5 md:border-b-0 md:border-r">
                <h2 className="text-xl font-semibold text-mm-dark">
                  {bench.name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {bench.structure} · {bench.role}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {bench.description}
                </p>
                <p className="mt-3 text-sm text-mm-dark">
                  Checker: {bench.checker}
                </p>
              </div>

              <div className="bg-mm-dark p-5 text-white">
                <p className="text-sm text-white/60">Example use case</p>
                <p className="mt-2 text-lg font-semibold">
                  {regime?.enterpriseExample}
                </p>
                <p className="mt-2 text-sm text-white/70">
                  Priority: {regime?.priority}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Compare architectures on these benchmarks.
        </p>
        <Button
          render={<Link href="/compare" />}
          className="h-9 bg-mm-charge px-3 text-sm font-medium"
        >
          Compare
          <ArrowUpRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
