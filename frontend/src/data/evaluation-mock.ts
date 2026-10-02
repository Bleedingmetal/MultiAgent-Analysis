import type {
  ArchitectureType,
} from "@/types/configuration"

export type TaskRegime = {
  id: string
  title: string
  enterpriseExample: string
  structure: string
  priority: string
  priorityDetail: string
  leanArchitecture: "single-agent" | "multi-agent" | "mixed"
  why: string
}

export type BenchmarkInfo = {
  id: string
  name: string
  shortName: string
  structure: string
  role: string
  description: string
  checker: string
  regimeId: string
}

export type ArchitectureArm = {
  id: string
  label: string
  family: "single" | "multi" | "workflow"
  summary: string
}

export type ComparisonRow = {
  benchmarkId: string
  architectureId: string
  success: number
  costPerSuccess: number
  latencySec: number
  note: string
}

export type EvaluationRun = {
  id: string
  benchmarkId: string
  architectureId: string
  model: string
  success: number
  costPerSuccess: number
  latencySec: number
  status: "Completed" | "Running" | "Failed"
  completedAt: string
}

export const taskRegimes: TaskRegime[] = [
  {
    id: "human-facing",
    title: "Human-facing tool use",
    enterpriseExample: "Employee help-desk assistant",
    structure: "Interactive · tool-calling",
    priority: "Latency",
    priorityDetail: "User is waiting on each step.",
    leanArchitecture: "single-agent",
    why: "Fewer hops usually means lower wait time.",
  },
  {
    id: "sequential",
    title: "Long sequential workflow",
    enterpriseExample: "Security or fraud case investigator",
    structure: "Step-dependent · shared state",
    priority: "Audit trail",
    priorityDetail: "Each step depends on the last.",
    leanArchitecture: "mixed",
    why: "Needs aligned steps and a clear trace.",
  },
  {
    id: "breadth-research",
    title: "Breadth-first research",
    enterpriseExample: "Research analyst over filings and news",
    structure: "Batch · many sources",
    priority: "Coverage and cost",
    priorityDetail: "Latency matters less than evidence quality.",
    leanArchitecture: "multi-agent",
    why: "Parallel workers fit wide research tasks.",
  },
]

export const benchmarks: BenchmarkInfo[] = [
  {
    id: "tau-retail",
    name: "τ-bench Retail",
    shortName: "τ-bench",
    structure: "Sequential · shared-state",
    role: "Fidelity anchor",
    description:
      "Tool-calling customer service with a simulated user.",
    checker: "Programmatic pass^k",
    regimeId: "human-facing",
  },
  {
    id: "finqa",
    name: "FinQA / TAT-QA",
    shortName: "FinQA",
    structure: "Deterministic · decomposable",
    role: "Cheap cell",
    description:
      "Numeric answers over financial tables and text.",
    checker: "Exact / numeric match",
    regimeId: "sequential",
  },
  {
    id: "fab",
    name: "Finance Agent Benchmark",
    shortName: "FAB",
    structure: "Breadth-first research",
    role: "Research cell",
    description:
      "Research tasks over real SEC filings.",
    checker: "Evidence + answer rubrics",
    regimeId: "breadth-research",
  },
]

export const architectures: ArchitectureArm[] = [
  {
    id: "single-agent",
    label: "Single agent",
    family: "single",
    summary: "One model plans, uses tools, and loops until done.",
  },
  {
    id: "orchestrator-workers",
    label: "Orchestrator-workers",
    family: "multi",
    summary: "Lead agent delegates to parallel workers, then synthesizes.",
  },
  {
    id: "prompt-chaining",
    label: "Prompt chaining",
    family: "workflow",
    summary: "Fixed steps in sequence with a check between them.",
  },
  {
    id: "parallelization",
    label: "Parallelization",
    family: "workflow",
    summary: "Split or repeat work, then aggregate.",
  },
]

export const comparisonRows: ComparisonRow[] = [
  {
    benchmarkId: "tau-retail",
    architectureId: "single-agent",
    success: 78.4,
    costPerSuccess: 0.028,
    latencySec: 4.1,
    note: "Lowest latency.",
  },
  {
    benchmarkId: "tau-retail",
    architectureId: "orchestrator-workers",
    success: 80.1,
    costPerSuccess: 0.067,
    latencySec: 11.8,
    note: "Higher success, higher latency.",
  },
  {
    benchmarkId: "tau-retail",
    architectureId: "prompt-chaining",
    success: 76.2,
    costPerSuccess: 0.031,
    latencySec: 6.4,
    note: "Between single and multi on latency.",
  },
  {
    benchmarkId: "finqa",
    architectureId: "single-agent",
    success: 88.6,
    costPerSuccess: 0.019,
    latencySec: 2.0,
    note: "Best cost / success.",
  },
  {
    benchmarkId: "finqa",
    architectureId: "orchestrator-workers",
    success: 90.4,
    costPerSuccess: 0.044,
    latencySec: 5.7,
    note: "Higher success, higher cost.",
  },
  {
    benchmarkId: "finqa",
    architectureId: "parallelization",
    success: 91.1,
    costPerSuccess: 0.052,
    latencySec: 3.9,
    note: "Highest success on this cell.",
  },
  {
    benchmarkId: "fab",
    architectureId: "single-agent",
    success: 61.2,
    costPerSuccess: 0.083,
    latencySec: 18.4,
    note: "Lower success on wide research.",
  },
  {
    benchmarkId: "fab",
    architectureId: "orchestrator-workers",
    success: 84.2,
    costPerSuccess: 0.071,
    latencySec: 22.6,
    note: "Highest success on this cell.",
  },
  {
    benchmarkId: "fab",
    architectureId: "parallelization",
    success: 79.5,
    costPerSuccess: 0.088,
    latencySec: 14.2,
    note: "Strong coverage, higher cost.",
  },
]

export const recentRuns: EvaluationRun[] = [
  {
    id: "RUN-024",
    benchmarkId: "fab",
    architectureId: "orchestrator-workers",
    model: "gpt-4.1-mini",
    success: 84.2,
    costPerSuccess: 0.071,
    latencySec: 22.6,
    status: "Completed",
    completedAt: "2026-03-28T16:42:00Z",
  },
  {
    id: "RUN-023",
    benchmarkId: "finqa",
    architectureId: "single-agent",
    model: "gpt-4.1-mini",
    success: 88.6,
    costPerSuccess: 0.019,
    latencySec: 2.0,
    status: "Completed",
    completedAt: "2026-03-28T14:10:00Z",
  },
  {
    id: "RUN-022",
    benchmarkId: "tau-retail",
    architectureId: "single-agent",
    model: "gpt-4.1-mini",
    success: 78.4,
    costPerSuccess: 0.028,
    latencySec: 4.1,
    status: "Completed",
    completedAt: "2026-03-27T19:05:00Z",
  },
  {
    id: "RUN-021",
    benchmarkId: "tau-retail",
    architectureId: "orchestrator-workers",
    model: "gpt-4.1-mini",
    success: 80.1,
    costPerSuccess: 0.067,
    latencySec: 11.8,
    status: "Completed",
    completedAt: "2026-03-27T18:22:00Z",
  },
  {
    id: "RUN-020",
    benchmarkId: "fab",
    architectureId: "single-agent",
    model: "gpt-4.1-mini",
    success: 61.2,
    costPerSuccess: 0.083,
    latencySec: 18.4,
    status: "Completed",
    completedAt: "2026-03-26T11:48:00Z",
  },
]

export const frameworkGates = [
  {
    id: "fidelity",
    title: "Fidelity",
    detail: "Reproduce a published τ-bench number within noise.",
  },
  {
    id: "discrimination",
    title: "Discrimination",
    detail: "Different task types show different tradeoffs.",
  },
  {
    id: "reliability",
    title: "Reliability",
    detail: "Results stay stable when samples are resampled.",
  },
  {
    id: "extensibility",
    title: "Extensibility",
    detail: "A new benchmark needs one adapter.",
  },
]

export function getBenchmark(id: string) {
  return benchmarks.find((b) => b.id === id)
}

export function getArchitecture(id: string) {
  return architectures.find((a) => a.id === id)
}

export function architectureLabelFromConfig(
  architecture: ArchitectureType,
) {
  switch (architecture) {
    case "single-agent":
      return "Single Agent"
    case "prompt-chaining":
      return "Prompt Chaining"
    case "routing":
      return "Routing"
    case "parallelization":
      return "Parallelization"
    case "evaluator-optimizer":
      return "Evaluator-Optimizer"
    case "autonomous-agent":
      return "Autonomous Agent"
    case "custom":
      return "Custom"
  }
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)
}

export function formatPct(value: number) {
  return `${value.toFixed(1)}%`
}

export function formatLatency(seconds: number) {
  return `${seconds.toFixed(1)}s`
}
