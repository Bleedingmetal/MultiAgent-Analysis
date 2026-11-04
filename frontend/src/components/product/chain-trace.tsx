import type { ChainStepTrace } from "@/lib/api"
import { roleLabel } from "@/lib/prompt-chain"
import { cn } from "@/lib/utils"

function statusTone(status: ChainStepTrace["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "Completed",
        className: "border-[#2f7a1f]/20 bg-[#2f7a1f]/8 text-[#2f7a1f]",
        dot: "bg-[#2f7a1f]",
      }
    case "invalid_output":
      return {
        label: "Invalid output",
        className: "border-mm-orange/25 bg-mm-orange/8 text-[#b34800]",
        dot: "bg-mm-orange",
      }
    case "error":
      return {
        label: "Error",
        className: "border-mm-orange/25 bg-mm-orange/8 text-[#b34800]",
        dot: "bg-mm-orange",
      }
    default:
      return {
        label: "Skipped",
        className: "border-border/70 bg-white text-muted-foreground",
        dot: "bg-muted-foreground/50",
      }
  }
}

function structuredPreview(value: Record<string, unknown> | null | undefined) {
  if (!value) return null
  const summary = typeof value.summary === "string" ? value.summary : null
  const answer = typeof value.answer === "string" ? value.answer : null
  const lists = ["facts", "calculations", "evidence"] as const
  return (
    <div className="mt-3 space-y-2">
      {summary ? (
        <p className="text-[13px] leading-relaxed text-mm-dark/90">{summary}</p>
      ) : null}
      {lists.map((key) => {
        const items = value[key]
        if (!Array.isArray(items) || items.length === 0) return null
        return (
          <div key={key}>
            <p className="font-data text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {key}
            </p>
            <ul className="mt-1 space-y-1">
              {items.map((item, index) => (
                <li
                  key={`${key}-${index}`}
                  className="text-[12px] leading-relaxed text-mm-dark/80"
                >
                  {String(item)}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {answer ? (
        <p className="font-data text-[12px] text-muted-foreground">
          Intermediate answer{" "}
          <span className="text-mm-dark">{answer}</span>
        </p>
      ) : null}
    </div>
  )
}

export function ChainTraceView({ steps }: { steps: ChainStepTrace[] }) {
  if (!steps.length) return null

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-border/70 bg-[#f8fafc]">
      <div className="border-b border-border/70 px-4 py-3.5">
        <p className="text-[13px] font-semibold text-mm-dark">
          Execution trace
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {steps.length} {steps.length === 1 ? "step" : "steps"} in order
        </p>
      </div>
      <ol>
        {steps.map((step, index) => {
          const tone = statusTone(step.status)
          return (
            <li
              key={step.id}
              className={cn(
                "px-4 py-4",
                index < steps.length - 1 && "border-b border-border/70",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-mm-dark">
                    {step.step_kind === "router" ? "Router" : `Step ${step.index + 1}`}
                    <span className="ml-2 font-medium">{step.name}</span>
                  </p>
                  <p className="mt-0.5 font-data text-[11px] text-muted-foreground">
                    {step.step_kind === "router"
                      ? "Routing decision"
                      : roleLabel(step.role)}{" "}
                    · {step.model}
                    {step.latency_sec
                      ? ` · ${step.latency_sec}s`
                      : ""}
                    {step.cost_usd
                      ? ` · $${step.cost_usd.toFixed(5)}`
                      : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-data text-[10px]",
                    tone.className,
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", tone.dot)} />
                  {tone.label}
                </span>
              </div>

              {step.objective ? (
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  {step.objective}
                </p>
              ) : null}

              {step.step_kind === "router" && step.selected_route ? (
                <p className="mt-3 font-data text-[12px] text-mm-dark">
                  Selected route{" "}
                  <span className="font-semibold">{step.selected_route}</span>
                  {step.routing_explanation ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — {step.routing_explanation}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {step.step_kind === "router" && step.available_routes?.length ? (
                <p className="mt-2 font-data text-[11px] text-muted-foreground">
                  Available: {step.available_routes.join(", ")}
                </p>
              ) : null}

              {structuredPreview(step.structured_output) ??
                (step.response ? (
                  <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-mm-dark/90">
                    {step.response}
                  </p>
                ) : null)}

              {step.error ? (
                <p className="mt-2 text-[12px] leading-relaxed text-[#b34800]">
                  {step.error}
                </p>
              ) : null}
              {step.parse_error ? (
                <p className="mt-2 text-[12px] leading-relaxed text-[#b34800]">
                  {step.parse_error}
                </p>
              ) : null}
              {step.warnings?.length ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {step.warnings.join(" ")}
                </p>
              ) : null}

              {step.status !== "skipped" ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                    Prompts and usage
                  </summary>
                  <div className="mt-3 grid gap-3">
                    {step.system_prompt ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-white px-3 py-2.5 font-data text-[11px] leading-relaxed text-muted-foreground">
                        {step.system_prompt}
                      </pre>
                    ) : null}
                    {step.user_prompt ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-white px-3 py-2.5 font-data text-[11px] leading-relaxed text-muted-foreground">
                        {step.user_prompt}
                      </pre>
                    ) : null}
                    <p className="font-data text-[11px] text-muted-foreground">
                      Tokens {step.prompt_tokens} → {step.completion_tokens}
                      {step.input_step_indexes?.length
                        ? ` · inputs from step ${step.input_step_indexes
                            .map((value) => value + 1)
                            .join(", ")}`
                        : ""}
                      {step.include_task ? " · original task included" : ""}
                    </p>
                  </div>
                </details>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
