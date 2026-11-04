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
    benchmark_id: Literal["finqa", "tau-retail", "fab"] = "finqa"
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
    # Full raw model output (includes reasoning + final answer).
    answer: str
    success: bool | None = None
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
