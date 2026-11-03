from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelSettings(BaseModel):
    provider: str | None = None
    model: str | None = None
    temperature: float | None = 0.5
    maxTokens: int | None = None
    systemPrompt: str | None = None


class ConfigurationNode(BaseModel):
    id: str
    name: str
    type: str
    layerId: str
    order: int = 0
    modelSettings: ModelSettings | None = None
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
    # "single-agent" is accepted from older clients and runs through the pipeline engine.
    mode: Literal["pipeline", "single-agent", "classify-plan"] = "pipeline"
    benchmark_id: Literal["finqa", "tau-retail", "fab"] = "finqa"
    task_id: str | None = None
    confirm: bool = False
    model_override: str | None = None
    parent_run_id: str | None = None


class ClassifierPlan(BaseModel):
    roles: list[str]
    rationale: str
    suggested_layout: str


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
    status: str = "completed"
    steps: list[TraceStep] = Field(default_factory=list)
    llm_calls: int = 0
