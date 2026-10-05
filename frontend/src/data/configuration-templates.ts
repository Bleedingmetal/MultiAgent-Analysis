import type {
  AgentConfiguration,
  ConfigurationEdge,
  ConfigurationLayer,
  ConfigurationNode,
  ConfigurationNodeType,
  LayerType,
  ModelProvider,
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
      temperature: 0.2,
    },

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
      "GPT",
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
      "Agent 1",
      "agents",
      0,
      "openai",
      "GPT",
      "Step 1",
    ),

    model(
      "chain-2",
      "Agent 2",
      "agents",
      1,
      "openai",
      "GPT",
      "Step 2",
    ),

    model(
      "chain-3",
      "Agent 3",
      "agents",
      2,
      "openai",
      "GPT",
      "Step 3",
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

    node(
      "router",
      "Router",
      "router",
      "orchestration",
      0,
    ),

    model(
      "route-a",
      "Agent A",
      "agents",
      0,
      "openai",
      "GPT",
      "Route A",
    ),

    model(
      "route-b",
      "Agent B",
      "agents",
      1,
      "anthropic",
      "Claude",
      "Route B",
    ),

    model(
      "route-c",
      "Agent C",
      "agents",
      2,
      "google",
      "Gemini",
      "Route C",
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

    edge(
      "router",
      "route-a",
      "Route A",
    ),

    edge(
      "router",
      "route-b",
      "Route B",
    ),

    edge(
      "router",
      "route-c",
      "Route C",
    ),

    edge("route-a", "final-answer"),
    edge("route-b", "final-answer"),
    edge("route-c", "final-answer"),
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
      "GPT",
      "Parallel Worker",
    ),

    model(
      "parallel-2",
      "Claude Agent",
      "agents",
      1,
      "anthropic",
      "Claude",
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
      "GPT",
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
      "GPT",
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

export const configurationTemplates = {
  "single-agent": singleAgentTemplate,

  "prompt-chaining":
    promptChainingTemplate,

  routing: routingTemplate,

  parallelization:
    parallelizationTemplate,

  "evaluator-optimizer":
    evaluatorOptimizerTemplate,

  "autonomous-agent":
    autonomousAgentTemplate,
} as const