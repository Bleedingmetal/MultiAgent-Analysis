"use client"

import { isCalculationStep, parseAgentOutput, parseReasoningSteps } from "@/lib/reasoning"
import { cn } from "@/lib/utils"

/** Reasoning prose laid out as a numbered train of thought. */
export function ReasoningSteps({
  text,
  className,
}: {
  text: string | null | undefined
  className?: string
}) {
  const steps = parseReasoningSteps(text)
  if (!steps.length) return null
  return (
    <ol className={cn("space-y-2", className)}>
      {steps.map((step, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
          <span className="pt-[3px] font-data text-[12px] text-muted-foreground">{i + 1}</span>
          <p
            className={cn(
              "text-[13.5px] leading-relaxed text-mm-dark",
              isCalculationStep(step) && "font-data text-[13px]",
            )}
          >
            {step}
          </p>
        </li>
      ))}
    </ol>
  )
}

/**
 * A whole agent response, readable: the steps it took, the calculation it committed
 * to, and what it concluded. Falls back to the raw text when there is no structure.
 */
export function AgentOutputView({
  raw,
  answerLabel = "Conclusion",
  className,
}: {
  raw: string | null | undefined
  answerLabel?: string
  className?: string
}) {
  const out = parseAgentOutput(raw)
  const empty = !out.steps.length && !out.program && !out.finalAnswer && !out.remainder
  if (empty) {
    return <p className={cn("text-[13px] text-muted-foreground", className)}>No output.</p>
  }
  return (
    <div className={cn("space-y-3", className)}>
      {out.steps.length ? <ReasoningSteps text={out.steps.join("\n")} /> : null}
      {out.remainder ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-data text-[12px] leading-relaxed text-mm-dark/90">
          {out.remainder}
        </pre>
      ) : null}
      {out.program ? (
        <p className="text-[12px] text-muted-foreground">
          Calculation{" "}
          <span className="font-data text-[12px] text-mm-dark">{out.program}</span>
        </p>
      ) : null}
      {out.finalAnswer ? (
        <p className="text-[13.5px] text-mm-dark">
          <span className="text-muted-foreground">{answerLabel} </span>
          <span className="font-semibold">{out.finalAnswer}</span>
        </p>
      ) : null}
    </div>
  )
}
