import { promptStepForRole } from "@/lib/prompt-chain"
import { defaultRouterSettings, promptStepForRoute } from "@/lib/routing"
import type {
  AgentConfiguration,
  ConfigurationEdge,
  ConfigurationLayer,
  ConfigurationNode,
  ConfigurationNodeType,
  LayerType,
  ModelProvider,
  PromptStepSettings,
} from "@/types/configuration"

const now = () => new Date().toISOString()

function layer(
  id: string,
  name: string,
  type: LayerType,
  order: number,
): ConfigurationLayer {
  return {
    id,
    name,
    type,
    order,
  }
}

function node(
  id: string,
  name: string,
  type: ConfigurationNodeType,
  layerId: string,
  order: number,
): ConfigurationNode {
  return {
    id,
    name,
    type,
    layerId,
    order,
  }
}

function model(
  id: string,
  name: string,
  layerId: string,
  order: number,
  provider: ModelProvider,
  modelName: string,
  role?: string,
  promptStep?: PromptStepSettings,
): ConfigurationNode {
  return {
    ...node(
      id,
      name,
      "model",
      layerId,
      order,
    ),

    modelSettings: {
      provider,
      model: modelName,
      temperature: 0.5,
    },

    promptStep,

    metadata: {
      role,
    },
  }
}

function edge(
  source: string,
  target: string,
  label?: string,
): ConfigurationEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label,
  }
}

/* SINGLE AGENT */

export const singleAgentTemplate: AgentConfiguration = {
  version: 1,

  id: "single-agent-template",
  name: "Single Agent",

  architecture: "single-agent",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),
    layer("agents", "Agent", "agents", 1),
    layer("output", "Output", "output", 2),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    model(
      "agent-1",
      "GPT Agent",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Primary Agent",
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge("prompt", "agent-1"),
    edge("agent-1", "final-answer"),
  ],
}

/* PROMPT CHAIN */

export const promptChainingTemplate: AgentConfiguration = {
  version: 1,

  id: "prompt-chain-template",
  name: "Prompt Chaining",

  architecture: "prompt-chaining",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),
    layer("agents", "Agent Chain", "agents", 1),
    layer("output", "Output", "output", 2),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    model(
      "chain-1",
      "Researcher",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Researcher",
      promptStepForRole("researcher"),
    ),

    model(
      "chain-2",
      "Analyst",
      "agents",
      1,
      "openai",
      "gpt-4o-mini",
      "Analyst",
      promptStepForRole("analyst"),
    ),

    model(
      "chain-3",
      "Verifier",
      "agents",
      2,
      "openai",
      "gpt-4o-mini",
      "Verifier",
      promptStepForRole("verifier"),
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge("prompt", "chain-1"),
    edge("chain-1", "chain-2"),
    edge("chain-2", "chain-3"),
    edge("chain-3", "final-answer"),
  ],
}

/* ROUTING */

export const routingTemplate: AgentConfiguration = {
  version: 1,

  id: "routing-template",
  name: "Routing",

  architecture: "routing",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),

    layer(
      "orchestration",
      "Orchestration",
      "orchestration",
      1,
    ),

    layer("agents", "Agents", "agents", 2),
    layer("output", "Output", "output", 3),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    {
      ...node(
        "router",
        "Router",
        "router",
        "orchestration",
        0,
      ),
      modelSettings: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
      },
      routerSettings: defaultRouterSettings(),
    },

    model(
      "route-researcher",
      "Researcher",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Researcher",
      promptStepForRoute("researcher"),
    ),

    model(
      "route-analyst",
      "Analyst",
      "agents",
      1,
      "openai",
      "gpt-4o-mini",
      "Analyst",
      promptStepForRoute("analyst"),
    ),

    model(
      "route-verifier",
      "Verifier",
      "agents",
      2,
      "openai",
      "gpt-4o-mini",
      "Verifier",
      promptStepForRoute("verifier"),
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge("prompt", "router"),
    edge("router", "route-researcher", "Researcher"),
    edge("router", "route-analyst", "Analyst"),
    edge("router", "route-verifier", "Verifier"),
    edge("route-researcher", "final-answer"),
    edge("route-analyst", "final-answer"),
    edge("route-verifier", "final-answer"),
  ],
}

/* PARALLEL */

export const parallelizationTemplate: AgentConfiguration = {
  version: 1,

  id: "parallel-template",
  name: "Parallelization",

  architecture: "parallelization",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),

    layer(
      "orchestration",
      "Orchestration",
      "orchestration",
      1,
    ),

    layer(
      "agents",
      "Parallel Agents",
      "agents",
      2,
    ),

    layer(
      "aggregation",
      "Aggregation",
      "aggregation",
      3,
    ),

    layer("output", "Output", "output", 4),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    node(
      "parallel-controller",
      "Parallel Controller",
      "parallel-controller",
      "orchestration",
      0,
    ),

    model(
      "parallel-1",
      "GPT Agent",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Parallel Worker",
    ),

    model(
      "parallel-2",
      "Claude Agent",
      "agents",
      1,
      "anthropic",
      "claude-sonnet-4-5",
      "Parallel Worker",
    ),

    node(
      "aggregator",
      "Aggregator",
      "aggregator",
      "aggregation",
      0,
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge(
      "prompt",
      "parallel-controller",
    ),

    edge(
      "parallel-controller",
      "parallel-1",
    ),

    edge(
      "parallel-controller",
      "parallel-2",
    ),

    edge(
      "parallel-1",
      "aggregator",
    ),

    edge(
      "parallel-2",
      "aggregator",
    ),

    edge(
      "aggregator",
      "final-answer",
    ),
  ],
}

/* EVALUATOR / OPTIMIZER */

export const evaluatorOptimizerTemplate: AgentConfiguration = {
  version: 1,

  id: "evaluator-template",
  name: "Evaluator-Optimizer",

  architecture: "evaluator-optimizer",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),

    layer(
      "agents",
      "Generator / Evaluator",
      "agents",
      1,
    ),

    layer("output", "Output", "output", 2),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    model(
      "generator",
      "Generator",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Generator",
    ),

    node(
      "evaluator",
      "Evaluator",
      "evaluator",
      "agents",
      1,
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge("prompt", "generator"),

    edge(
      "generator",
      "evaluator",
      "Candidate",
    ),

    edge(
      "evaluator",
      "generator",
      "Feedback",
    ),

    edge(
      "evaluator",
      "final-answer",
      "Accepted",
    ),
  ],
}

/* AUTONOMOUS */

export const autonomousAgentTemplate: AgentConfiguration = {
  version: 1,

  id: "autonomous-template",
  name: "Autonomous Agent",

  architecture: "autonomous-agent",

  createdAt: now(),
  updatedAt: now(),

  layers: [
    layer("input", "Input", "input", 0),

    layer(
      "agents",
      "Autonomous Agent",
      "agents",
      1,
    ),

    layer("tools", "Tools", "tools", 2),

    layer("output", "Output", "output", 3),
  ],

  nodes: [
    node(
      "prompt",
      "Task input",
      "input",
      "input",
      0,
    ),

    model(
      "autonomous-agent",
      "Autonomous Agent",
      "agents",
      0,
      "openai",
      "gpt-4o-mini",
      "Autonomous Agent",
    ),

    node(
      "tool-1",
      "Tool",
      "tool",
      "tools",
      0,
    ),

    node(
      "tool-2",
      "Tool",
      "tool",
      "tools",
      1,
    ),

    node(
      "final-answer",
      "Final Answer",
      "output",
      "output",
      0,
    ),
  ],

  edges: [
    edge(
      "prompt",
      "autonomous-agent",
    ),

    edge(
      "autonomous-agent",
      "tool-1",
      "Tool Call",
    ),

    edge(
      "autonomous-agent",
      "tool-2",
      "Tool Call",
    ),

    edge(
      "tool-1",
      "autonomous-agent",
      "Result",
    ),

    edge(
      "tool-2",
      "autonomous-agent",
      "Result",
    ),

    edge(
      "autonomous-agent",
      "final-answer",
    ),
  ],
}

/* CUSTOM -- blank multi-agent slate */

export const customTemplate: AgentConfiguration = {
  version: 1,
  id: "custom-template",
  name: "Custom",
  architecture: "custom",
  createdAt: now(),
  updatedAt: now(),
  layers: [
    layer("input", "Input", "input", 0),
    layer("orchestration", "Orchestration", "orchestration", 1),
    layer("agents", "Agents", "agents", 2),
    layer("output", "Output", "output", 3),
  ],
  nodes: [
    node("prompt", "Task input", "input", "input", 0),
    node("router", "Router", "router", "orchestration", 0),
    model("agent-1", "GPT Agent", "agents", 0, "openai", "gpt-4o-mini", "Primary"),
    node("final-answer", "Final Answer", "output", "output", 0),
  ],
  edges: [
    edge("prompt", "router"),
    edge("router", "agent-1"),
    edge("agent-1", "final-answer"),
  ],
}

export const configurationTemplates = {
  "single-agent": singleAgentTemplate,
  "prompt-chaining": promptChainingTemplate,
  routing: routingTemplate,
  parallelization: parallelizationTemplate,
  "evaluator-optimizer": evaluatorOptimizerTemplate,
  "autonomous-agent": autonomousAgentTemplate,
  custom: customTemplate,
} as const