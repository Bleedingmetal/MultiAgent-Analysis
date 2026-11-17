#!/usr/bin/env node
// `npm run dev` / `npm run setup`: find a Python and hand off to start.py or setup.py.
// `npm run regrade` (below) instead runs the FinQA re-grade in the backend's venv.
// Node is guaranteed here (npm is running), Python's name is not: macOS has only
// `python3`, Windows often only `py` or `python`.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// `npm run regrade`: re-grade stored FinQA runs with the current checker (no model calls).
// It runs in the backend's own venv, which `npm run setup` creates.
if (process.argv.includes("--regrade")) {
  const fs = require("node:fs");
  const venvPython = path.join(
    __dirname, "backend", ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!fs.existsSync(venvPython)) {
    console.error("The backend is not set up yet. Run `npm run setup` first.");
    process.exit(1);
  }
  const args = [path.join(__dirname, "backend", "scripts", "rescore_finqa.py")];
  if (!process.argv.includes("--check")) args.push("--write");
  const run = spawnSync(venvPython, args, {
    stdio: "inherit",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (run.status === 0 && args.includes("--write")) {
    console.log("\nDone. Restart the app (Ctrl+C, then `npm run dev`) to see the new pass rates.");
  }
  process.exit(run.status ?? 1);
}

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
