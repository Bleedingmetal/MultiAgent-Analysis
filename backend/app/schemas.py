from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelSettings(BaseModel):
    provider: str | None = None
    model: str | None = None
    temperature: float | None = 0.2
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
    mode: Literal["single-agent", "classify-plan"] = "single-agent"
    benchmark_id: Literal["finqa", "tau-retail", "fab"] = "finqa"
    task_id: str | None = None
    confirm: bool = False


class ClassifierPlan(BaseModel):
    roles: list[str]
    rationale: str
    suggested_layout: str


class RunResult(BaseModel):
    id: str
    mode: str
    benchmark_id: str
    task_id: str
    configuration_id: str
    configuration_name: str
    architecture: str
    model: str
    question: str
    expected_answer: str | None = None
    answer: str
    success: bool | None = None
    latency_sec: float
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    classifier_plan: ClassifierPlan | None = None
    note: str | None = None
    created_at: str
