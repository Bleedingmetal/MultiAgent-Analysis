"use client"

import { Check, X } from "@phosphor-icons/react"

import type { FabCriterion, RunResult } from "@/lib/api"
import { cn } from "@/lib/utils"

type FabEvaluation = {
  partial_credit?: number
  all_pass?: boolean
  dealbreaker_failed?: boolean
  hedged?: boolean
  criteria?: FabCriterion[]
  judges?: string[]
  fab_version?: string
  approximation_note?: string
  error?: string
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** A FAB answer graded against its rubric: the score, then every criterion with the jury's verdict. */
export function FabRubric({ run }: { run: RunResult }) {
  const ev = (run.evaluation ?? {}) as FabEvaluation
  const criteria = ev.criteria ?? []
  if (ev.error) return <p className="text-[13px] text-[#b34800]">{ev.error}</p>
  if (!criteria.length) return null
  const met = criteria.filter((c) => c.passed).length

  return (
    <section aria-label="Rubric">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-mm-dark">
          {pct(ev.partial_credit ?? 0)}
        </p>
        <p className="text-[13px] text-muted-foreground">
          partial credit · {met} of {criteria.length} criteria met
          {ev.dealbreaker_failed ? " · a must-pass criterion failed, so credit is 0" : ""}
          {ev.hedged ? " · the answer hedges" : ""}
        </p>
      </div>

      <ul className="mt-4 divide-y divide-border/60">
        {criteria.map((c) => (
          <li key={c.id} className="flex gap-3 py-2.5">
            <span
              className={cn(
                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                c.passed ? "bg-mm-green/15 text-[#2f7a1f]" : "bg-mm-orange/15 text-[#b34800]",
              )}
              aria-label={c.passed ? "Met" : "Not met"}
            >
              {c.passed ? <Check className="size-3" weight="bold" /> : <X className="size-3" weight="bold" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-snug text-mm-dark">
                {c.criterion}
                {c.must_pass ? (
                  <span className="ml-2 whitespace-nowrap text-[11px] font-medium text-[#b34800]">must pass</span>
                ) : null}
              </p>
              {c.votes[0]?.reason ? (
                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                  {c.votes.length > 1
                    ? `${c.votes.filter((v) => v.pass).length} of ${c.votes.length} judges: ${c.votes[0].reason}`
                    : c.votes[0].reason}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 font-data text-[11px] text-muted-foreground" title="Severity weight">
              ×{c.severity}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        FAB v{ev.fab_version ?? "2.1"} rubric, graded by {ev.judges?.join(", ") || "our judge"}. Approximates the official
        three-model jury, so not comparable with the vals.ai leaderboard.
      </p>
    </section>
  )
}
