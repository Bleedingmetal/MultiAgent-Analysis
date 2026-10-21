# Benchmark data

Run `make datasets` from the repository root to populate this directory.

| Benchmark | Source | Generated files |
|---|---|---|
| FinQA | [czyssrs/FinQA](https://github.com/czyssrs/FinQA) | `finqa/test.json`, `finqa/sample20.json` |
| FAB | [vals-ai/finance-agent](https://github.com/vals-ai/finance-agent) | `fab/public.csv`, `fab/sample20.json` |
| τ-bench retail | [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench) | `tau_bench/tasks_test_retail.py`, `tau_bench/retail_sample.json` |

Full and generated source files are ignored by Git where configured in `.gitignore`.
Review each upstream project's license before redistributing its data.
