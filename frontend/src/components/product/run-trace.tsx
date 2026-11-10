"use client"

import { Bezel } from "@/components/product/ui-bits"
import { AgentOutputView } from "@/components/product/reasoning-steps"
import type { TraceStep } from "@/lib/api"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<TraceStep["kind"], string> = {
  agent: "Agent",
  router: "Router",
  controller: "Controller",
  evaluator: "Evaluator",
  aggregator: "Aggregator",
  vote: "Vote",
}

function decisionSummary(step: TraceStep): string | null {
  const d = step.decision
  if (!d) return null
  switch (step.kind) {
    case "router":
      return `→ ${String(d.route_name)}${d.reason ? ` · ${String(d.reason)}` : ""}`
    case "controller":
      return `${String(d.strategy)}${d.rationale ? ` · ${String(d.rationale)}` : ""}`
    case "evaluator":
      return `${String(d.verdict)}${d.feedback ? ` · ${String(d.feedback)}` : ""}${
        d.note ? ` (${String(d.note)})` : ""
      }`
    case "vote":
      return `winner ${String(d.winner)}`
    default:
      return null
  }
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-data text-[12px] leading-relaxed text-muted-foreground">
      {children}
    </pre>
  )
}

export function RunTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <Bezel coreClassName="p-5">
      <h3 className="text-[15px] font-semibold text-mm-dark">Trace</h3>
      <ol className="mt-4 space-y-2.5">
        {steps.map((step) => {
          const summary = decisionSummary(step)
          return (
            <li
              key={step.index}
              className="rounded-xl border border-border/70 bg-white"
            >
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                  <span className="font-data text-[11px] text-muted-foreground">
                    {step.index + 1}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      step.kind === "agent"
                        ? "bg-mm-blue/8 text-mm-blue"
                        : "bg-[#f4f7fb] text-mm-dark",
                    )}
                  >
                    {KIND_LABEL[step.kind] ?? step.kind}
                  </span>
                  <span className="text-[13.5px] font-medium text-mm-dark">
                    {step.node_name}
                    {step.round > 1 ? (
                      <span className="ml-1.5 text-muted-foreground">
                        round {step.round}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-auto font-data text-[11px] text-muted-foreground">
                    {step.model ? `${step.model} · ` : ""}
                    {step.prompt_tokens}
                    {step.cached_tokens ? ` (${step.cached_tokens} cached)` : ""}→{step.completion_tokens} · $
                    {step.cost_usd.toFixed(5)} · {step.latency_sec}s
                  </span>
                  {summary ? (
                    <span className="basis-full text-[12.5px] text-muted-foreground">
                      {summary}
                    </span>
                  ) : null}
                </summary>
                <div className="border-t border-border/70 px-4 py-3">
                  {step.tool_calls.length > 0 ? (
                    <div className="mb-3">
                      <p className="text-[12px] font-medium text-muted-foreground">
                        Tool calls
                      </p>
                      <ul className="mt-2 space-y-1 font-data text-[12px] text-mm-dark/90">
                        {step.tool_calls.map((call, i) => (
                          <li key={i}>
                            {call.name}({JSON.stringify(call.arguments)}) →{" "}
                            {call.result}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {step.decision && step.kind === "controller" ? (
                    <div className="mb-3">
                      <p className="text-[12px] font-medium text-muted-foreground">
                        Assignments
                      </p>
                      <Pre>
                        {JSON.stringify(step.decision.assignments, null, 2)}
                      </Pre>
                    </div>
                  ) : null}
                  {step.decision && step.kind === "vote" ? (
                    <div className="mb-3">
                      <p className="text-[12px] font-medium text-muted-foreground">
                        Tally
                      </p>
                      <Pre>{JSON.stringify(step.decision.tally, null, 2)}</Pre>
                    </div>
                  ) : null}
                  <AgentOutputView
                    raw={step.output}
                    answerLabel={
                      step.kind === "agent" || step.kind === "aggregator"
                        ? "Conclusion"
                        : "Decision"
                    }
                  />
                  {step.system_prompt ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
                        System prompt
                      </summary>
                      <Pre>{step.system_prompt}</Pre>
                    </details>
                  ) : null}
                  {step.user_prompt ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
                        User prompt
                      </summary>
                      <Pre>{step.user_prompt}</Pre>
                    </details>
                  ) : null}
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </Bezel>
  )
}
