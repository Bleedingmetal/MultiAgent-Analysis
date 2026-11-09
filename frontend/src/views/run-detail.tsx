"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowLeft, Copy, Play } from "@phosphor-icons/react"

import { ChainTraceView } from "@/components/product/chain-trace"
import { ConversationView } from "@/components/product/conversation-view"
import { FinQAReasoningComparisonView } from "@/components/product/finqa-reasoning-comparison"
import { Bezel, Reveal } from "@/components/product/ui-bits"
import { Button } from "@/components/ui/button"
import { RunTrace } from "@/components/product/run-trace"
import { ReasoningSteps } from "@/components/product/reasoning-steps"
import {
  benchmarkName,
  chainSteps,
  createRun,
  getRun,
  pipelineSteps,
  type RunResult,
} from "@/lib/api"
import { cloneConfigurationFromSnapshot } from "@/lib/configuration-storage"
import { PROVIDER_MODELS } from "@/lib/provider-models"
import type { AgentConfiguration } from "@/types/configuration"

// "" = keep each node's configured model
const KEEP_MODELS = ""
const MODEL_OPTIONS = [
  ...PROVIDER_MODELS.anthropic,
  ...PROVIDER_MODELS.openai,
  ...PROVIDER_MODELS.google,
].map((m) => m.id)

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [run, setRun] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [model, setModel] = useState(KEEP_MODELS)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await getRun(id)
        if (cancelled) return
        setRun(res)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Run not found")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  function saveAsConfig() {
    if (!run?.configuration) {
      setActionError("This run has no saved configuration snapshot.")
      return
    }
    const saved = cloneConfigurationFromSnapshot(
      run.configuration as AgentConfiguration,
      {
        name: `${run.configuration_name} (from ${run.id})`,
        modelOverride: model,
      },
    )
    router.push(`/configurations/${saved.id}`)
  }

  async function rerun() {
    if (!run?.configuration) {
      setActionError("This run has no saved configuration snapshot.")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const next = await createRun({
        configuration: {
          ...run.configuration,
          // ensure name stays readable
          name: run.configuration_name,
        },
        mode: run.mode,
        benchmark_id: run.benchmark_id,
        task_id: run.task_id,
        model_override: model || null,
        parent_run_id: run.id,
        confirm: true,
      })
      router.push(`/runs/${next.id}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rerun failed")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading run…</p>
    )
  }

  if (error || !run) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-xl font-semibold text-mm-dark">
          {error ?? "Not found"}
        </h2>
        <Button
          render={<Link href="/runs" />}
          variant="outline"
          className="h-10 rounded-full px-4"
        >
          <ArrowLeft className="size-4" />
          Runs
        </Button>
      </div>
    )
  }

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
          <div>
            <h2 className="font-data text-[28px] font-semibold tracking-tight text-mm-dark md:text-[34px]">
              {run.id}
            </h2>
            <p className="mt-2 font-data text-[12px] text-muted-foreground">
              {formatWhen(run.created_at)}
              <span className="mx-2 text-border">/</span>
              {run.mode}
              {run.parent_run_id ? (
                <>
                  <span className="mx-2 text-border">/</span>
                  {run.parent_run_id.startsWith("E2E-") ? "question in end-to-end run" : "from"}{" "}
                  <Link
                    href={
                      run.parent_run_id.startsWith("E2E-")
                        ? `/runs/e2e/${run.parent_run_id}`
                        : `/runs/${run.parent_run_id}`
                    }
                    className="text-mm-blue hover:underline"
                  >
                    {run.parent_run_id}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          {run.status === "incomplete" ? (
            <p className="text-[32px] font-semibold tracking-tight text-[#b34800]">
              Incomplete
            </p>
          ) : run.success != null ? (
            <p
              className={`text-[32px] font-semibold tracking-tight ${
                run.success ? "text-[#2f7a1f]" : "text-[#b34800]"
              }`}
            >
              {run.success ? "Pass" : "Fail"}
            </p>
          ) : (
            <p className="text-[32px] font-semibold tracking-tight text-mm-dark">
              {run.mode === "classify-plan" ? "Plan" : "Done"}
            </p>
          )}
        </div>
      </Reveal>

      <Reveal delay={0.05} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Config", run.configuration_name],
          ["Benchmark", benchmarkName(run.benchmark_id)],
          ["Models", run.model],
          ["Cost", `$${run.cost_usd.toFixed(5)}`],
          ["Latency", `${run.latency_sec}s`],
          ["Tokens", `${run.prompt_tokens} → ${run.completion_tokens}`],
          ["LLM calls", String(run.llm_calls ?? 1)],
          ["Architecture", run.architecture],
          ["Task", run.task_id],
        ].map(([label, value]) => (
          <div key={label} className="surface p-4">
            <p className="text-[11px] font-medium text-muted-foreground">
              {label}
            </p>
            <p className="mt-1.5 break-all text-sm font-medium text-mm-dark">
              {value}
            </p>
          </div>
        ))}
      </Reveal>

      <Reveal delay={0.08}>
        <Bezel coreClassName="p-5">
          <h3 className="text-[15px] font-semibold text-mm-dark">
            {run.conversation ? "Customer's situation" : "Question"}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-mm-dark">
            {run.question}
          </p>
          {run.error || run.note ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {run.error ?? run.note}
            </p>
          ) : null}
          {chainSteps(run).length ? <ChainTraceView steps={chainSteps(run)} /> : null}
          {run.expected_answer != null ? (
            <p className="mt-2 font-data text-[12px] text-muted-foreground">
              Expected{" "}
              {run.expected_display &&
              run.expected_display !== run.expected_answer
                ? `${run.expected_display} · verify ${run.expected_answer}`
                : run.expected_answer}
            </p>
          ) : null}
          {run.conversation ? (
            <div className="mt-6">
              <ConversationView run={run} />
            </div>
          ) : null}
          {run.reasoning_comparison ? (
            <FinQAReasoningComparisonView
              comparison={run.reasoning_comparison}
              agentReasoning={run.reasoning}
            />
          ) : run.reasoning ? (
            <>
              <h3 className="mt-6 text-[15px] font-semibold text-mm-dark">
                Reasoning
              </h3>
              <ReasoningSteps text={run.reasoning} className="mt-3" />
            </>
          ) : null}
          {!run.conversation ? (
            <>
              <h3 className="mt-6 text-[15px] font-semibold text-mm-dark">
                Final answer
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-mm-dark/90">
                {run.scored_answer || run.answer}
              </p>
              <h3 className="mt-6 text-[15px] font-semibold text-mm-dark">
                Raw output
              </h3>
              <p className="mt-2 whitespace-pre-wrap font-data text-[12px] leading-relaxed text-muted-foreground">
                {run.answer}
              </p>
            </>
          ) : null}
          {run.classifier_plan ? (
            <div className="mt-4 rounded-xl bg-[#f4f7fb] p-4 text-sm">
              <p className="font-medium text-mm-dark">
                {run.classifier_plan.suggested_layout}
              </p>
              <p className="mt-1 text-muted-foreground">
                {run.classifier_plan.roles.join(" · ")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {run.classifier_plan.rationale}
              </p>
            </div>
          ) : null}
        </Bezel>
      </Reveal>

      {pipelineSteps(run).length > 0 ? (
        <Reveal delay={0.09}>
          <RunTrace steps={pipelineSteps(run)} />
        </Reveal>
      ) : null}

      {(run.system_prompt || run.user_prompt) && (
        <Reveal delay={0.1} className="grid gap-4 lg:grid-cols-2">
          {run.system_prompt ? (
            <Bezel coreClassName="p-5">
              <h3 className="text-[15px] font-semibold text-mm-dark">
                System prompt
              </h3>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-data text-[12px] leading-relaxed text-muted-foreground">
                {run.system_prompt}
              </pre>
            </Bezel>
          ) : null}
          {run.user_prompt ? (
            <Bezel coreClassName="p-5">
              <h3 className="text-[15px] font-semibold text-mm-dark">
                User prompt
              </h3>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-data text-[12px] leading-relaxed text-muted-foreground">
                {run.user_prompt}
              </pre>
            </Bezel>
          ) : null}
        </Reveal>
      )}

      <Reveal delay={0.12}>
        <Bezel coreClassName="p-5">
          <h3 className="text-[15px] font-semibold text-mm-dark">
            Clone & rerun
          </h3>

          <label className="mt-4 block max-w-sm space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              Model
            </span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-mm-charge/35"
            >
              <option value={KEEP_MODELS}>Keep configured models</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  All nodes → {m}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={busy || !run.configuration}
              onClick={() => void rerun()}
              className="island-cta disabled:pointer-events-none disabled:opacity-50"
            >
              <span>{busy ? "Running…" : "Rerun"}</span>
              <span className="island-cta-icon" aria-hidden>
                <Play className="size-3.5" weight="fill" />
              </span>
            </button>
            <Button
              type="button"
              variant="outline"
              disabled={!run.configuration}
              onClick={saveAsConfig}
              className="h-[2.85rem] rounded-full px-4 text-sm"
            >
              <Copy className="size-4" weight="bold" />
              Save as config
            </Button>
          </div>

          {actionError ? (
            <p className="mt-3 text-sm text-[#b34800]">{actionError}</p>
          ) : null}
        </Bezel>
      </Reveal>
    </div>
  )
}
