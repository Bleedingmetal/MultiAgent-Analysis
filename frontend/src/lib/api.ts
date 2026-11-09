const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// "single-agent" appears on runs recorded before the pipeline engine.
export type RunMode =
  | "pipeline"
  | "single-agent"
  | "classify-plan"
  | "prompt-chain"
  | "routing"
export type ProviderId = "openai" | "anthropic" | "google"
export type BenchmarkId = "finqa" | "tau-retail" | "tau2-retail" | "fab"

export const BENCHMARK_NAMES: Record<string, string> = {
  finqa: "FinQA",
  "tau-retail": "τ-bench Retail",
  "tau2-retail": "τ²-bench Retail",
  fab: "Finance Agent Benchmark",
}

export function benchmarkName(id: string) {
  return BENCHMARK_NAMES[id] ?? id
}

/** Benchmarks where each task is a multi-turn conversation rather than a question. */
export function isConversational(id: string) {
  return id === "tau-retail" || id === "tau2-retail"
}

/** "question" / "conversation", pluralised. */
export function taskNoun(id: string, n = 2) {
  const one = isConversational(id) ? "conversation" : "question"
  return n === 1 ? one : `${one}s`
}

export type ConversationTurn = {
  role: "user" | "assistant" | "tool"
  turn?: number
  content?: string | null
  tool_calls?: { id?: string; name: string; arguments: Record<string, unknown> }[]
  tool_call_id?: string
  error?: boolean
  requestor?: string
  cost_usd?: number
}

export type DbChange = {
  path: string
  change: "changed" | "added" | "removed"
  from?: unknown
  to?: unknown
  value?: unknown
}

export type ClassifierPlan = {
  roles: string[]
  rationale: string
  suggested_layout: string
}

export type TraceStep = {
  index: number
  node_id: string
  node_name: string
  node_type: string
  kind: "agent" | "router" | "controller" | "evaluator" | "aggregator" | "vote"
  provider?: string | null
  model?: string | null
  round: number
  system_prompt?: string | null
  user_prompt?: string | null
  output: string
  decision?: Record<string, unknown> | null
  tool_calls: {
    id?: string
    name: string
    arguments: Record<string, unknown>
    result: string | null
    error?: boolean
    executed?: boolean
  }[]
  llm_calls: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_sec: number
}

export type ChainStepTrace = {
  id: string
  run_id: string
  index: number
  node_id: string
  name: string
  role: string
  objective?: string
  step_kind?: "agent" | "router"
  selected_route?: string | null
  available_routes?: string[]
  routing_explanation?: string | null
  provider: string
  model: string
  temperature: number
  max_tokens: number
  output_format?: "text" | "structured"
  status: "completed" | "invalid_output" | "error" | "skipped"
  include_task?: boolean
  input_step_indexes?: number[]
  system_prompt?: string
  user_prompt?: string
  prompt_truncated?: boolean
  response?: string | null
  structured_output?: Record<string, unknown> | null
  parse_error?: string | null
  error?: string | null
  warnings?: string[]
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_sec: number
  started_at?: string | null
}

export type FinQAReasoningComparison = {
  expected_program: string
  agent_program?: string | null
  expected_steps: Record<string, unknown>[]
  expected_evidence: string[]
  expected_result?: string | null
  agent_result?: string | null
  program_exact_match?: boolean | null
  operator_sequence_match?: boolean | null
  execution_matches_expected?: boolean | null
  parse_error?: string | null
}

export type RunConfiguration = {
  version?: number
  id: string
  name: string
  description?: string | null
  architecture: string
  createdAt?: string | null
  updatedAt?: string | null
  layers: unknown[]
  nodes: unknown[]
  edges: unknown[]
}

export type RunResult = {
  id: string
  mode: RunMode
  benchmark_id: BenchmarkId
  task_id: string
  configuration_id: string
  configuration_name: string
  architecture: string
  model: string
  temperature?: number
  question: string
  expected_answer: string | null
  expected_display?: string | null
  scored_answer?: string | null
  reasoning?: string | null
  reasoning_comparison?: FinQAReasoningComparison | null
  label_disputed?: boolean
  answer: string
  success: boolean | null
  latency_sec: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  classifier_plan: ClassifierPlan | null
  note: string | null
  created_at: string
  system_prompt?: string | null
  user_prompt?: string | null
  configuration?: RunConfiguration | null
  parent_run_id?: string | null
  status?: string
  error?: string | null
  // ChainStepTrace for prompt-chain / routing runs, TraceStep for pipeline runs
  steps?: (ChainStepTrace | TraceStep)[]
  llm_calls?: number
  // τ-bench runs: the transcript, the official evaluation and the database diff
  conversation?: ConversationTurn[] | null
  evaluation?: Record<string, unknown> | null
  db_changes?: DbChange[] | null
}

/** Prompt-chain / routing steps (ChainStepTrace carries a run_id; TraceStep does not). */
export function chainSteps(run: Pick<RunResult, "steps">): ChainStepTrace[] {
  return (run.steps ?? []).filter((s): s is ChainStepTrace => "run_id" in s)
}

/** Pipeline-engine steps. */
export function pipelineSteps(run: Pick<RunResult, "steps">): TraceStep[] {
  return (run.steps ?? []).filter((s): s is TraceStep => !("run_id" in s))
}

export type BenchmarkInfo = {
  id: BenchmarkId
  name: string
  structure: string
  role: string
  task_count: number
  scored: boolean
  available?: boolean
  default_system_prompt?: string
  notes: string
}

export type DatasetTask = {
  id: string
  question: string
  expected_answer: string | null
  expected_display?: string | null
  scored: boolean
  metadata: Record<string, unknown>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export function getHealth() {
  return api<{
    status: string
    model: string
    openai_configured: boolean
    providers?: Record<ProviderId, boolean>
    require_confirm?: boolean
    spend?: {
      day: string
      spend_usd: number
      run_count: number
      daily_budget_usd: number
      max_runs_per_day: number
      min_seconds_between_runs: number
      max_completion_tokens: number
      in_flight: boolean
      remaining_budget_usd: number
      remaining_runs: number
    }
  }>("/api/health")
}

export function getDatasets() {
  return api<{ benchmarks: BenchmarkInfo[] }>("/api/datasets")
}

export function getDatasetTasks(benchmarkId: BenchmarkId, limit = 20) {
  return api<{ benchmark_id: string; tasks: DatasetTask[] }>(
    `/api/datasets/${benchmarkId}/tasks?limit=${limit}`,
  )
}

export function createRun(body: {
  configuration: unknown
  mode: RunMode
  benchmark_id: BenchmarkId
  task_id?: string | null
  confirm?: boolean
  model_override?: string | null
  parent_run_id?: string | null
}) {
  return api<RunResult>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ confirm: true, ...body }),
  })
}

export function listRuns(limit = 50) {
  return api<{ runs: RunResult[] }>(`/api/runs?limit=${limit}`)
}

export function getRun(runId: string) {
  return api<RunResult>(`/api/runs/${runId}`)
}

// ---- End-to-end (batch) runs ----

export type BatchStatus =
  | "running"
  | "completed"
  | "stopped"
  | "cancelled"
  | "interrupted"
  | "failed"

export type BatchItemStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "mixed"
  | "unscored"
  | "error"
  | "skipped"

export type BatchAttempt = {
  pass_index: number
  status: "passed" | "failed" | "unscored" | "error"
  run_id?: string | null
  scored_answer?: string | null
  success?: boolean | null
  program_match?: boolean | null
  cost_usd: number
  latency_sec: number
  error?: string | null
}

export type BatchItem = {
  index: number
  task_id: string
  question: string
  expected_display?: string | null
  status: BatchItemStatus
  run_id?: string | null
  scored_answer?: string | null
  success?: boolean | null
  program_match?: boolean | null
  label_disputed?: boolean
  cost_usd: number
  latency_sec: number
  error?: string | null
  attempts?: BatchAttempt[]
  passes_passed?: number
  passes_failed?: number
}

export type PassSummary = {
  pass_index: number
  done: number
  passed: number
  failed: number
  errors: number
  pass_rate?: number | null
  cost_usd: number
  avg_latency_sec?: number | null
}

export type BatchSummary = {
  total: number
  done: number
  errors: number
  skipped: number
  passes?: number
  attempts_total?: number
  attempts_done?: number
  // answers (question x pass); with one pass these are question counts
  passed: number
  failed: number
  pass_rate?: number | null
  pass_all_rate?: number | null
  pass_any_rate?: number | null
  mixed?: number
  per_pass?: PassSummary[]
  pass_rate_min?: number | null
  pass_rate_max?: number | null
  cost_usd: number
  avg_cost_usd?: number | null
  cost_per_pass_usd?: number | null
  projected_cost_usd?: number | null
  avg_latency_sec?: number | null
  p50_latency_sec?: number | null
  p95_latency_sec?: number | null
  prompt_tokens: number
  completion_tokens: number
  program_match_rate?: number | null
  disputed?: number
  elapsed_sec: number
}

export type BatchRun = {
  id: string
  configuration_id: string
  configuration_name: string
  architecture: string
  mode: string
  benchmark_id: string
  size: number
  budget_usd: number
  concurrency: number
  passes?: number
  status: BatchStatus
  stop_reason?: string | null
  created_at: string
  finished_at?: string | null
  models: string[]
  summary: BatchSummary
  // Snapshot of the configuration that ran (absent in list responses)
  configuration?: RunConfiguration | null
  items: BatchItem[]
}

export function createBatch(body: {
  configuration: unknown
  mode: RunMode
  benchmark_id: BenchmarkId
  size: number | null
  budget_usd: number
  concurrency?: number
  passes?: number
}) {
  return api<BatchRun>("/api/batches", {
    method: "POST",
    body: JSON.stringify({ confirm: true, ...body }),
  })
}

export function listBatches(configurationId?: string, limit = 20) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (configurationId) query.set("configuration_id", configurationId)
  return api<{ batches: BatchRun[] }>(`/api/batches?${query}`)
}

export function getBatch(batchId: string) {
  return api<BatchRun>(`/api/batches/${batchId}`)
}

export function cancelBatch(batchId: string) {
  return api<BatchRun>(`/api/batches/${batchId}/cancel`, { method: "POST" })
}
