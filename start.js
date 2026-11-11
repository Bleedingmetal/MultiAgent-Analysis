#!/usr/bin/env node
// `npm run dev` / `npm run setup`: find a Python and hand off to start.py or setup.py.
// Node is guaranteed here (npm is running), Python's name is not: macOS has only
// `python3`, Windows often only `py` or `python`.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const script = process.argv.includes("--setup") ? "setup.py" : "start.py";
const target = path.join(__dirname, script);
const candidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];

for (const [cmd, pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, "--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(cmd, [...pre, target], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}
console.error("Python 3 was not found. Install it from https://www.python.org/downloads/ and rerun.");
process.exit(1);
