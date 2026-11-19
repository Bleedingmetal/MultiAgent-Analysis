# Benchmark data

Run `make datasets` from the repository root to populate this directory.

| Benchmark | Source | Generated files |
|---|---|---|
| FinQA | [czyssrs/FinQA](https://github.com/czyssrs/FinQA) | `finqa/test.json`, `finqa/sample20.json` |
| FAB v2.1 | [vals-ai/finance-agent-v2](https://github.com/vals-ai/finance-agent-v2) @ `25b6cab` (sha256-checked) | `fab/v2.1/public.csv`, `fab/v2.1/manifest.json` (27 public questions with rubrics; the Validation and Test splits are private) |
| τ-bench retail | [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench) | none: tasks, tools and database ship inside the `tau_bench` package |
| τ²-bench retail | [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench) | `tau2/domains/retail/{db.json,policy.md,tasks.json,split_tasks.json}` |

Full and generated source files are ignored by Git where configured in `.gitignore`.
Review each upstream project's license before redistributing its data.
