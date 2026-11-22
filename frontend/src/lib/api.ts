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
  // Of prompt_tokens, served from the provider's prompt cache
  cached_tokens?: number
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
  // Rubric benchmarks (FAB): graded credit 0-1 (Partial Credit); success is All-Pass
  score?: number | null
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
  // Dataset version, where the source publishes versions (FAB: "2.1")
  version?: string
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
      run_budget_usd?: number
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

/** The first `limit` tasks, or with `query`, matching tasks from the whole benchmark. */
export function getDatasetTasks(benchmarkId: BenchmarkId, limit = 20, query?: string) {
  const q = query?.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""
  return api<{ benchmark_id: string; tasks: DatasetTask[] }>(
    `/api/datasets/${benchmarkId}/tasks?limit=${limit}${q}`,
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
  | "paused"
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
  score?: number | null
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
  // FAB: mean Partial Credit, the primary metric (pass_rate is then the All-Pass rate)
  mean_score?: number | null
  score_low?: number | null
  score_high?: number | null
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
  /** "top-up": extra questions run to settle an Overview comparison, not a run of its own */
  purpose?: "evaluation" | "top-up" | string
  status: BatchStatus
  stop_reason?: string | null
  budget_ack?: boolean
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

/** Continue a batch paused at the budget check; the cap rises to the projection. */
export function continueBatch(batchId: string, budgetUsd?: number) {
  return api<BatchRun>(`/api/batches/${batchId}/continue`, {
    method: "POST",
    body: JSON.stringify({ budget_usd: budgetUsd ?? null }),
  })
}


/** Reliability (pass^k) and consistency for one configuration under one set of conditions. */
export type RepeatabilityGroup = {
  configuration_id: string
  configuration_name: string
  architecture: string
  benchmark_id: string
  mode: string
  models: string
  condition: string
  tasks: number
  attempts: number
  max_attempts_per_task: number
  /** the end-to-end runs whose questions are pooled here */
  batch_ids: string[]
  reliability: { k: number; value: number | null; eligible_tasks: number }
  consistency: {
    output: number | null
    execution: number | null
    combined: number | null
    tasks: number
    execution_tasks: number
    weights: { output: number; execution: number }
  }
}

/** pass^k and consistency over every stored execution of each task (no model calls). */
export function getRepeatability(benchmark: string, k = 3) {
  return api<{ k: number; groups: RepeatabilityGroup[] }>(
    `/api/metrics/repeatability?benchmark=${encodeURIComponent(benchmark)}&k=${k}`,
  )
}

/** The headline accuracy of a run: graded credit where the benchmark has it (FAB), else pass rate. */
export function primaryAccuracy(summary: Pick<BatchSummary, "pass_rate" | "mean_score">) {
  return summary.mean_score ?? summary.pass_rate ?? null
}

/** One FAB rubric criterion as graded (see backend app/benchmarks/fab_grading.py). */
export type FabCriterion = {
  id: number
  criterion: string
  severity: number
  must_pass: boolean
  passed: boolean
  votes: { model: string; pass: boolean; reason: string }[]
}

/** One run's headline figures on the Overview (backend app/overview.py). */
export type OverviewFigures = {
  batch_id: string
  configuration_id: string
  configuration_name: string
  architecture: string
  models: string[]
  accuracy: number | null
  cost_per_correct_usd: number | null
  time_per_question_sec: number | null
  questions: number
  passes: number
  created_at: string
}

/** A question one side got right and the other didn't, on the shared questions. */
export type OverviewDiffQuestion = {
  task_id: string
  question: string
  single: number
  multi: number
  single_item: number
  multi_item: number
  /** The run each item is in (a top-up run, for questions added to settle the comparison) */
  single_batch_id?: string
  multi_batch_id?: string
}

/** Single vs multi-agent, paired on the questions both runs graded. */
export type OverviewComparison =
  | { comparable: false; shared: number }
  | {
      comparable: true
      shared: number
      single_accuracy: number
      multi_accuracy: number
      difference: number
      verdict: "settled" | "too-close" | "even"
      more_questions: number | null
      single_cost_per_correct_usd: number | null
      multi_cost_per_correct_usd: number | null
      cost_to_settle_usd: number | null
      multi_lost: OverviewDiffQuestion[]
      multi_won: OverviewDiffQuestion[]
    }

export type OverviewTask = {
  benchmark_id: string
  task_count: number | null
  complete_runs: number
  best: OverviewFigures | null
  single: OverviewFigures | null
  multi: OverviewFigures | null
  comparison: OverviewComparison | null
  approximate: boolean
}

export type OverviewRecent = {
  batch_id: string
  configuration_name: string
  architecture: string
  benchmark_id: string
  status: string
  done: number
  total: number
  accuracy: number | null
  change: number | null
  created_at: string
  not_finished: string | null
}

export type OverviewAttention =
  | { kind: "unfinished"; batch_id: string; configuration_name: string; benchmark_id: string; reason: string }
  | { kind: "too-close"; benchmark_id: string; single_batch_id: string; multi_batch_id: string; more_questions: number | null; cost_usd: number | null }
  | { kind: "not-comparable"; benchmark_id: string; shared: number; single_batch_id: string; multi_batch_id: string }

export type Overview = {
  tasks: OverviewTask[]
  recent: OverviewRecent[]
  attention: OverviewAttention[]
  hidden_configuration_ids: string[]
  running: number
  /** Top-up runs to settle a comparison are still to start or going */
  settling?: boolean
}

/** Where each task stands, what changed, what needs attention. */
export function getOverview() {
  return api<Overview>("/api/overview")
}

/** Keep a configuration off the Overview (it stays under Runs and Compare), or bring it back. */
export function setOverviewHidden(configurationId: string, hidden: boolean) {
  return api<{ hidden_configuration_ids: string[] }>("/api/overview/hidden", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configuration_id: configurationId, hidden }),
  })
}

/** What settling a too-close comparison takes: the questions each side is missing, and the cost. */
export type SettlePlan = {
  benchmark_id: string
  target_questions: number
  sides: { side: "single" | "multi"; configuration_name: string; batch_id: string; missing: number; estimated_cost_usd: number }[]
  total_estimated_cost_usd: number
}

/** The plan only; nothing runs. */
export function planSettle(benchmarkId: string) {
  return api<SettlePlan>("/api/overview/settle", {
    method: "POST",
    body: JSON.stringify({ benchmark_id: benchmarkId, confirm: false }),
  })
}

/** Starts the top-up runs (spends money); returns at once with the first run's id. */
export function runSettle(benchmarkId: string) {
  return api<{ started: boolean; batch_id: string; plan: SettlePlan }>("/api/overview/settle", {
    method: "POST",
    body: JSON.stringify({ benchmark_id: benchmarkId, confirm: true }),
  })
}

/** Configurations kept off the Overview. */
export function getOverviewHidden() {
  return api<{ hidden_configuration_ids: string[] }>("/api/overview/hidden")
}

// ── The Lab ────────────────────────────────────────────────────────────────

/** Something the Lab finds worth investigating, with the pair of runs to open. */
export type LabProblem = {
  kind: "failures" | "flaky" | "too-close" | "unfinished"
  title: string
  detail: string
  benchmark_id: string
  configuration_id: string | null
  batch_id: string | null
  other_batch_id: string | null
}

/** One run as a point on the trade-off map. Accuracy is a fraction. */
export type LabRunPoint = {
  batch_id: string
  configuration_id: string
  configuration_name: string
  architecture: string
  models: string[]
  created_at: string
  questions: number
  passes: number
  complete: boolean
  accuracy: number | null
  cost_per_correct_usd: number | null
  time_per_question_sec: number | null
}

/** A question one run got right and the other got wrong. */
export type LabFlip = {
  task_id: string
  question: string
  a_score: number
  b_score: number
  a_answer: string | null
  b_answer: string | null
  a_run_id: string | null
  b_run_id: string | null
}

/** What changed from run a (before) to run b (after), on the questions both ran. */
export type LabDiff = {
  a: LabRunPoint
  b: LabRunPoint
  shared: number
  comparable: boolean
  /** Null when the runs share no questions. */
  accuracy: { a: number | null; b: number | null; points: number | null; relative: number | null }
  cost_per_correct: { a: number | null; b: number | null; relative: number | null }
  time_per_question: { a: number | null; b: number | null; relative: number | null; seconds: number | null }
  verdict: "real" | "too-close" | "no-change" | "not-comparable"
  more_questions: number | null
  cost_to_settle_usd: number | null
  fixed: LabFlip[]
  broke: LabFlip[]
  still_wrong: number
  still_right: number
  changes: { what: string; before: string | null; after: string | null }[]
  same_config: boolean
}

export function getLabProblems() {
  return api<{ problems: LabProblem[] }>("/api/lab/problems")
}

export function getLabRuns(benchmarkId: string) {
  return api<{ benchmark_id: string; runs: LabRunPoint[] }>(`/api/lab/runs?benchmark=${encodeURIComponent(benchmarkId)}`)
}

/** How steady one setup is across all its runs; separate runs pool like passes. */
export type LabSteadiness = {
  batch_id: string
  configuration_name: string
  runs: { batch_id: string; created_at: string; passes: number; accuracy: number | null }[]
  questions: number
  tries_per_question: { min: number; max: number } | null
  always_right: number
  never_right: number
  sometimes: number
  pass_hat_3: number | null
  mixed: { task_id: string; question: string | null; right: number; tries: number }[]
}

export function getLabSteadiness(batchId: string) {
  return api<LabSteadiness>(`/api/lab/steadiness?batch=${encodeURIComponent(batchId)}`)
}

export function getLabDiff(beforeBatchId: string, afterBatchId: string) {
  return api<LabDiff>(`/api/lab/diff?a=${encodeURIComponent(beforeBatchId)}&b=${encodeURIComponent(afterBatchId)}`)
}
