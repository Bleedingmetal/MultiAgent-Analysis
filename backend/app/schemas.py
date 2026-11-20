from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelSettings(BaseModel):
    provider: str | None = None
    model: str | None = None
    temperature: float | None = 0.5
    maxTokens: int | None = None
    systemPrompt: str | None = None


class PromptStepInputs(BaseModel):
    """What a chain step receives. Both parts are optional and independent."""

    # Original task (context + question) from the benchmark.
    task: bool = True
    # Outputs of earlier steps: none, only the immediately preceding step, or all.
    previousOutputs: Literal["none", "last", "all"] = "last"


class PromptStepSettings(BaseModel):
    """Agent step settings on a model node (prompt chain or routing specialist).

    `role` is a label only; behavior comes from the editable fields below.
    """

    role: str = "custom"
    objective: str = ""
    instructions: str = ""
    # Empty means "use the generic default template".
    promptTemplate: str = ""
    inputs: PromptStepInputs = Field(default_factory=PromptStepInputs)
    outputFormat: Literal["text", "structured"] = "text"
    # Routing: stable id returned by the router (`selected_route`).
    routeId: str = ""
    # Routing: when the router should pick this specialist.
    routeDescription: str = ""


class RouterSettings(BaseModel):
    """LLM router node settings (orchestration layer)."""

    instructions: str = ""
    promptTemplate: str = ""
    # Used when the router returns an unknown route id (must match a routeId).
    fallbackRouteId: str = ""


class ConfigurationNode(BaseModel):
    id: str
    name: str
    type: str
    layerId: str
    order: int = 0
    modelSettings: ModelSettings | None = None
    promptStep: PromptStepSettings | None = None
    routerSettings: RouterSettings | None = None
    metadata: dict[str, Any] | None = None


class AgentConfiguration(BaseModel):
    version: int | None = 1
    id: str
    name: str
    description: str | None = None
    architecture: str
    createdAt: str | None = None
    updatedAt: str | None = None
    layers: list[dict[str, Any]] = Field(default_factory=list)
    nodes: list[ConfigurationNode] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)


class RunRequest(BaseModel):
    configuration: AgentConfiguration
    # "pipeline" runs any configuration through the generic engine. "prompt-chain" and
    # "routing" use the dedicated runners. "single-agent" is accepted from older
    # clients and runs through the pipeline engine.
    mode: Literal["pipeline", "single-agent", "classify-plan", "prompt-chain", "routing"] = (
        "pipeline"
    )
    benchmark_id: Literal["finqa", "tau-retail", "tau2-retail", "fab"] = "finqa"
    task_id: str | None = None
    confirm: bool = False
    model_override: str | None = None
    parent_run_id: str | None = None


class ClassifierPlan(BaseModel):
    roles: list[str]
    rationale: str
    suggested_layout: str


class FinQAReasoningComparison(BaseModel):
    expected_program: str
    agent_program: str | None = None
    expected_steps: list[dict[str, Any]] = Field(default_factory=list)
    expected_evidence: list[str] = Field(default_factory=list)
    expected_result: str | None = None
    agent_result: str | None = None
    program_exact_match: bool | None = None
    operator_sequence_match: bool | None = None
    execution_matches_expected: bool | None = None
    parse_error: str | None = None


StepStatus = Literal["completed", "invalid_output", "error", "skipped"]


class ChainStepTrace(BaseModel):
    """One executed (or skipped) agent step of a prompt chain.

    Everything needed to audit the step is stored here: what it was given, the
    exact prompt sent, what came back, and what it cost.
    """

    id: str
    run_id: str
    # 0-based execution order within the run.
    index: int
    node_id: str
    name: str
    role: str
    objective: str = ""
    # "router" for the routing decision step; "agent" for chain/specialist steps.
    step_kind: Literal["agent", "router"] = "agent"
    # Routing audit fields (router step only unless noted).
    selected_route: str | None = None
    available_routes: list[str] = Field(default_factory=list)
    routing_explanation: str | None = None
    provider: str
    model: str
    temperature: float
    max_tokens: int
    # Format actually used (the final step always runs as text).
    output_format: Literal["text", "structured"] = "text"
    status: StepStatus
    include_task: bool = True
    # Indexes of earlier steps whose output was passed to this step.
    input_step_indexes: list[int] = Field(default_factory=list)
    # Prompts exactly as sent to the model (empty for skipped steps).
    system_prompt: str = ""
    user_prompt: str = ""
    prompt_truncated: bool = False
    response: str | None = None
    # Parsed JSON envelope for structured steps (summary/facts/calculations/...).
    structured_output: dict[str, Any] | None = None
    parse_error: str | None = None
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_sec: float = 0.0
    started_at: str | None = None


class TraceStep(BaseModel):
    """One node activation in a pipeline run (audit trail)."""

    index: int
    node_id: str
    node_name: str
    node_type: str
    # agent | router | controller | evaluator | aggregator | vote
    kind: str
    provider: str | None = None
    model: str | None = None
    # >1 when an evaluator sent the node back for revision
    round: int = 1
    system_prompt: str | None = None
    user_prompt: str | None = None
    output: str = ""
    # Structured decision: route chosen, subtask assignments, verdict, vote tally
    decision: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    llm_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    # Of prompt_tokens, how many were served from the provider's prompt cache
    cached_tokens: int = 0
    cost_usd: float = 0.0
    latency_sec: float = 0.0


class RunResult(BaseModel):
    id: str
    mode: str
    benchmark_id: str
    task_id: str
    configuration_id: str
    configuration_name: str
    architecture: str
    model: str
    temperature: float = 0.5
    question: str
    expected_answer: str | None = None
    # Human-facing expected (e.g. "$94 million"); scoring uses expected_answer.
    expected_display: str | None = None
    # Final-answer span that was scored from the model output.
    scored_answer: str | None = None
    # Model thought process / scratch work (audit trail).
    reasoning: str | None = None
    reasoning_comparison: FinQAReasoningComparison | None = None
    # FinQA's gold program and its own step annotation disagree for this question.
    label_disputed: bool = False
    # Full raw model output (includes reasoning + final answer).
    answer: str
    success: bool | None = None
    # Graded credit in [0, 1] for rubric benchmarks (FAB: Partial Credit; success is All-Pass)
    score: float | None = None
    latency_sec: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    classifier_plan: ClassifierPlan | None = None
    note: str | None = None
    created_at: str
    # Detail / replay fields
    system_prompt: str | None = None
    user_prompt: str | None = None
    configuration: AgentConfiguration | None = None
    parent_run_id: str | None = None
    # "completed" | "incomplete" (a chain stopped before its final step).
    status: str = "completed"
    error: str | None = None
    # Per-step trace: ChainStepTrace for prompt-chain / routing runs, TraceStep for
    # pipeline runs. The two have disjoint required fields, so validation is unambiguous.
    steps: list[ChainStepTrace | TraceStep] = Field(default_factory=list)
    llm_calls: int = 0
    # Conversational benchmarks (tau-bench): the full transcript, the official
    # evaluation, and what the agent changed in the simulated database.
    conversation: list[dict[str, Any]] | None = None
    evaluation: dict[str, Any] | None = None
    db_changes: list[dict[str, Any]] | None = None


BatchStatus = Literal[
    "running", "paused", "completed", "stopped", "cancelled", "interrupted", "failed"
]
# "mixed": the question passed in some passes and failed in others
BatchItemStatus = Literal[
    "pending", "running", "passed", "failed", "mixed", "unscored", "error", "skipped"
]


class BatchRequest(BaseModel):
    configuration: AgentConfiguration
    mode: Literal["pipeline", "prompt-chain", "routing"] = "pipeline"
    benchmark_id: Literal["finqa", "tau-retail", "tau2-retail", "fab"] = "finqa"
    # Number of questions; None = the whole dataset.
    size: int | None = Field(default=25, ge=1)
    # Stop starting new questions once the batch has spent this much.
    budget_usd: float = Field(default=1.0, gt=0)
    concurrency: int = Field(default=4, ge=1, le=8)
    # Full passes over the whole question set, one after another. One pass is not
    # representative: the same model gives different answers on different runs.
    passes: int = Field(default=1, ge=1, le=10)
    confirm: bool = False


class BatchAttempt(BaseModel):
    """One pass over one question."""

    pass_index: int
    status: Literal["passed", "failed", "unscored", "error"]
    run_id: str | None = None
    scored_answer: str | None = None
    success: bool | None = None
    score: float | None = None
    program_match: bool | None = None
    cost_usd: float = 0.0
    latency_sec: float = 0.0
    error: str | None = None


class BatchItem(BaseModel):
    index: int
    task_id: str
    question: str
    expected_display: str | None = None
    status: BatchItemStatus = "pending"
    run_id: str | None = None
    scored_answer: str | None = None
    success: bool | None = None
    # FinQA: did the agent's Program line execute to the expected result?
    program_match: bool | None = None
    label_disputed: bool = False
    # Summed over passes; latency is the mean per pass.
    cost_usd: float = 0.0
    latency_sec: float = 0.0
    error: str | None = None
    # One entry per finished pass. run_id / scored_answer above are the first pass's.
    attempts: list[BatchAttempt] = Field(default_factory=list)
    passes_passed: int = 0
    passes_failed: int = 0


class PassSummary(BaseModel):
    """One full pass over the question set."""

    pass_index: int
    done: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0
    pass_rate: float | None = None
    cost_usd: float = 0.0
    avg_latency_sec: float | None = None


class BatchSummary(BaseModel):
    # Questions
    total: int = 0
    done: int = 0
    errors: int = 0
    skipped: int = 0
    # Answers (question x pass). With one pass these equal the question counts.
    passes: int = 1
    attempts_total: int = 0
    attempts_done: int = 0
    passed: int = 0
    failed: int = 0
    # passed / (passed + failed) over all answers; errors are reported separately.
    pass_rate: float | None = None
    # Of the fully answered questions: correct in every pass (pass^k) / in at least one (pass@k)
    pass_all_rate: float | None = None
    pass_any_rate: float | None = None
    # Mean graded credit over scored answers (FAB: Partial Credit, the primary metric;
    # pass_rate is then the All-Pass rate)
    mean_score: float | None = None
    # 95% interval on mean_score, built on per-question means (a question's passes are not independent)
    score_low: float | None = None
    score_high: float | None = None
    # Questions whose passes disagreed with each other
    mixed: int = 0
    # Each full pass on its own, so the spread between passes is visible
    per_pass: list[PassSummary] = Field(default_factory=list)
    pass_rate_min: float | None = None
    pass_rate_max: float | None = None
    cost_usd: float = 0.0
    avg_cost_usd: float | None = None
    # $ spent per correct answer (whole batch cost / passes).
    cost_per_pass_usd: float | None = None
    # Average cost per question x total, while running.
    projected_cost_usd: float | None = None
    avg_latency_sec: float | None = None
    p50_latency_sec: float | None = None
    p95_latency_sec: float | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    program_match_rate: float | None = None
    # Questions whose FinQA label contradicts itself (either answer is accepted).
    disputed: int = 0
    elapsed_sec: float = 0.0


class BatchRun(BaseModel):
    id: str
    configuration_id: str
    configuration_name: str
    architecture: str
    mode: str
    benchmark_id: str
    size: int
    budget_usd: float
    concurrency: int
    passes: int = 1
    status: BatchStatus = "running"
    stop_reason: str | None = None
    # True once the user chose to continue past the projected-overspend pause
    budget_ack: bool = False
    created_at: str
    finished_at: str | None = None
    models: list[str] = Field(default_factory=list)
    summary: BatchSummary = Field(default_factory=BatchSummary)
    configuration: AgentConfiguration | None = None
    items: list[BatchItem] = Field(default_factory=list)
