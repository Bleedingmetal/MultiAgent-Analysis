const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export type RunMode = "single-agent" | "classify-plan"
export type BenchmarkId = "finqa" | "tau-retail" | "fab"

export type ClassifierPlan = {
  roles: string[]
  rationale: string
  suggested_layout: string
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
  question: string
  expected_answer: string | null
  answer: string
  success: boolean | null
  latency_sec: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  classifier_plan: ClassifierPlan | null
  note: string | null
  created_at: string
}

export type BenchmarkInfo = {
  id: BenchmarkId
  name: string
  structure: string
  role: string
  task_count: number
  scored: boolean
  notes: string
}

export type DatasetTask = {
  id: string
  question: string
  expected_answer: string | null
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
}) {
  return api<RunResult>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ confirm: true, ...body }),
  })
}

export function listRuns(limit = 50) {
  return api<{ runs: RunResult[] }>(`/api/runs?limit=${limit}`)
}
