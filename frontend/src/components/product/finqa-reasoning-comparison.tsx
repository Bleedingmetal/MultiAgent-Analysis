import type { FinQAReasoningComparison } from "@/lib/api"
import { cn } from "@/lib/utils"

function StatusPill({
  value,
  success,
}: {
  value: string
  success: boolean | null | undefined
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-data text-[10px]",
        success === true &&
          "border-[#2f7a1f]/20 bg-[#2f7a1f]/8 text-[#2f7a1f]",
        success === false &&
          "border-mm-orange/25 bg-mm-orange/8 text-[#b34800]",
        success == null &&
          "border-border/70 bg-white text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          success === true && "bg-[#2f7a1f]",
          success === false && "bg-mm-orange",
          success == null && "bg-muted-foreground/50",
        )}
      />
      {value}
    </span>
  )
}

function stepLabel(step: Record<string, unknown>) {
  const raw = String(step.op ?? "operation").toLowerCase()
  if (raw.startsWith("minus")) return "subtract"
  if (raw.startsWith("divide")) return "divide"
  if (raw.startsWith("add")) return "add"
  if (raw.startsWith("multiply")) return "multiply"
  if (raw.startsWith("greater")) return "greater"
  return raw.replace(/\d+-\d+$/, "")
}

export function FinQAReasoningComparisonView({
  comparison,
  agentReasoning,
}: {
  comparison: FinQAReasoningComparison
  agentReasoning?: string | null
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-border/70 bg-[#f8fafc]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div>
          <p className="text-[13px] font-semibold text-mm-dark">
            Reasoning comparison
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Agent calculation versus FinQA ground truth
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill
            value={
              comparison.execution_matches_expected
                ? "Execution matches"
                : comparison.execution_matches_expected === false
                  ? "Execution differs"
                  : "Not executed"
            }
            success={comparison.execution_matches_expected}
          />
          <StatusPill
            value={
              comparison.operator_sequence_match
                ? "Operations align"
                : comparison.operator_sequence_match === false
                  ? "Operations differ"
                  : "No operation match"
            }
            success={comparison.operator_sequence_match}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2">
        <div className="border-b border-border/70 p-4 md:border-r md:border-b-0">
          <p className="font-data text-[10px] font-semibold uppercase tracking-[0.08em] text-mm-blue">
            Agent
          </p>
          {agentReasoning ? (
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-mm-dark/90">
              {agentReasoning}
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">
              No concise reasoning was returned.
            </p>
          )}
          <pre className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-white px-3 py-2.5 font-data text-[11px] leading-relaxed text-mm-dark">
            {comparison.agent_program ?? "No FinQA program returned"}
          </pre>
          <p className="mt-2 font-data text-[11px] text-muted-foreground">
            Executed result{" "}
            <span className="text-mm-dark">
              {comparison.agent_result ?? "unavailable"}
            </span>
          </p>
          {comparison.parse_error ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[#b34800]">
              {comparison.parse_error}
            </p>
          ) : null}
        </div>

        <div className="p-4">
          <p className="font-data text-[10px] font-semibold uppercase tracking-[0.08em] text-mm-blue">
            FinQA expected
          </p>
          {comparison.expected_steps.length ? (
            <ol className="mt-3 space-y-2">
              {comparison.expected_steps.map((step, index) => {
                const args = [step.arg1, step.arg2]
                  .filter((value) => value != null && value !== "none")
                  .map(String)
                  .join(", ")
                return (
                  <li
                    key={`${stepLabel(step)}-${index}`}
                    className="grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-2 text-[12px]"
                  >
                    <span className="font-data text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 font-data text-mm-dark">
                      {stepLabel(step)}({args})
                    </span>
                    <span className="font-data text-muted-foreground">
                      → {String(step.res ?? "—")}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : null}
          <pre className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-white px-3 py-2.5 font-data text-[11px] leading-relaxed text-mm-dark">
            {comparison.expected_program}
          </pre>
          <p className="mt-2 font-data text-[11px] text-muted-foreground">
            Expected result{" "}
            <span className="text-mm-dark">
              {comparison.expected_result ?? "unavailable"}
            </span>
          </p>
        </div>
      </div>

      {comparison.expected_evidence.length ? (
        <details className="border-t border-border/70 px-4 py-3">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            View FinQA expected evidence ({comparison.expected_evidence.length})
          </summary>
          <div className="mt-3 space-y-2">
            {comparison.expected_evidence.map((evidence, index) => (
              <p
                key={`${index}-${evidence.slice(0, 24)}`}
                className="text-[12px] leading-relaxed text-mm-dark/80"
              >
                {evidence}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
