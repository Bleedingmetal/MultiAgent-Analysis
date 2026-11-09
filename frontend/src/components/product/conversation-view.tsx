"use client"

import { useState } from "react"
import { CaretDown, CheckCircle, Wrench, XCircle } from "@phosphor-icons/react"

import type { ConversationTurn, DbChange, RunResult } from "@/lib/api"
import { cn } from "@/lib/utils"

/*
 * A τ-bench run is a conversation, not an answer. This view shows what the grader
 * saw: the official evaluation (reward, database match, assertions), the transcript
 * with every tool call and its result inline, and what changed in the database.
 */

type Check = { label: string; met: boolean | null; detail?: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function checksFrom(ev: Record<string, unknown>): Check[] {
  const out: Check[] = []
  for (const c of (ev.nl_assertions as unknown[] | null) ?? []) {
    const r = asRecord(c)
    out.push({ label: String(r.nl_assertion ?? ""), met: Boolean(r.met), detail: r.justification ? String(r.justification) : undefined })
  }
  for (const c of (ev.communicate_checks as unknown[] | null) ?? []) {
    const r = asRecord(c)
    out.push({ label: `Told the customer: ${String(r.info ?? "")}`, met: Boolean(r.met), detail: r.justification ? String(r.justification) : undefined })
  }
  const outputs = ev.outputs as Record<string, boolean> | null | undefined
  if (outputs) {
    for (const [text, met] of Object.entries(outputs)) {
      out.push({ label: `Told the customer: ${text}`, met })
    }
  }
  return out
}

function actionsFrom(ev: Record<string, unknown>): { name: string; met: boolean | null }[] {
  const checks = ev.action_checks as unknown[] | null | undefined
  if (checks?.length) {
    return checks.map((c) => {
      const r = asRecord(c)
      return { name: String(asRecord(r.action).name ?? "?"), met: Boolean(r.action_match) }
    })
  }
  const ref = ev.reference_actions as unknown[] | null | undefined
  if (ref?.length) {
    const done = new Set(((ev.agent_actions as unknown[] | null) ?? []).map((a) => String(asRecord(a).name)))
    return ref
      .map((a) => String(asRecord(a).name))
      .filter((n) => n !== "respond")
      .map((name) => ({ name, met: done.has(name) }))
  }
  return []
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-[14px] font-medium",
          tone === "good" ? "text-[#2f7a1f]" : tone === "bad" ? "text-[#b34800]" : "text-mm-dark",
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function EvaluationSummary({ run }: { run: RunResult }) {
  const ev = asRecord(run.evaluation)
  const reward = typeof ev.reward === "number" ? ev.reward : null
  const dbMatch = typeof ev.db_match === "boolean" ? ev.db_match : null
  const basis = ((ev.reward_basis as string[] | null) ?? []).join(" + ")
  const checks = checksFrom(ev)
  const actions = actionsFrom(ev)
  const ended = String(ev.termination_reason ?? "").replace(/_/g, " ")
  const userCost = typeof ev.user_simulator_cost_usd === "number" ? ev.user_simulator_cost_usd : null
  return (
    <div className="rounded-2xl border border-border/70 bg-white">
      <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
        <Fact
          label="Official reward"
          value={reward == null ? "—" : `${Math.round(reward * 100)}%`}
          tone={reward == null ? undefined : reward >= 1 ? "good" : "bad"}
        />
        <Fact
          label="Database end state"
          value={dbMatch == null ? "not graded" : dbMatch ? "matches reference" : "differs from reference"}
          tone={dbMatch == null ? undefined : dbMatch ? "good" : "bad"}
        />
        <Fact label="Graded on" value={basis || "DB"} />
        <Fact label="Ended" value={ended ? `${ended} · ${String(ev.turns ?? "?")} messages` : "—"} />
        <Fact
          label="Simulated customer"
          value={`${String(ev.user_simulator_model ?? "")}${userCost != null ? ` · $${userCost.toFixed(4)}` : ""}`}
        />
      </div>
      {checks.length || actions.length ? (
        <div className="grid gap-4 border-t border-border/70 px-5 py-4 md:grid-cols-[1.3fr_1fr]">
          {checks.length ? (
            <ul className="space-y-2">
              {checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                  {c.met ? (
                    <CheckCircle className="mt-0.5 size-4 shrink-0 text-[#2f7a1f]" weight="fill" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-[#b34800]" weight="fill" />
                  )}
                  <span className="min-w-0">
                    <span className="text-mm-dark">{c.label}</span>
                    {c.detail ? <span className="mt-0.5 block text-[12px] text-muted-foreground">{c.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <span />}
          {actions.length ? (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Reference actions</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {actions.map((a, i) => (
                  <li
                    key={i}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-data text-[11px]",
                      a.met ? "border-mm-green/40 bg-mm-green/10 text-[#2f7a1f]" : "border-mm-orange/40 bg-mm-orange/10 text-[#b34800]",
                    )}
                  >
                    {a.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function short(value: unknown, max = 160) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function ToolCallRow({
  call,
  result,
}: {
  call: { id?: string; name: string; arguments: Record<string, unknown> }
  result?: ConversationTurn
}) {
  const [open, setOpen] = useState(false)
  const args = Object.entries(call.arguments ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
    .join(", ")
  return (
    <div className="rounded-xl border border-border/70 bg-[#fafbfd]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        <Wrench className="mt-0.5 size-3.5 shrink-0 text-mm-charge" weight="bold" />
        <span className="min-w-0 flex-1 font-data text-[12px] leading-relaxed text-mm-dark">
          <span className="font-semibold">{call.name}</span>
          <span className="text-muted-foreground">({args})</span>
          {result ? (
            <span className={cn("mt-0.5 block truncate", result.error ? "text-[#b34800]" : "text-muted-foreground")}>
              {result.error ? "error · " : "→ "}
              {short(result.content ?? "", 120)}
            </span>
          ) : null}
        </span>
        <CaretDown className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} weight="bold" />
      </button>
      {open && result ? (
        <pre className="max-h-64 overflow-auto border-t border-border/70 px-3 py-2 whitespace-pre-wrap font-data text-[11.5px] leading-relaxed text-muted-foreground">
          {result.content}
        </pre>
      ) : null}
    </div>
  )
}

export function Transcript({ turns, compact }: { turns: ConversationTurn[]; compact?: boolean }) {
  const results = new Map<string, ConversationTurn>()
  for (const t of turns) if (t.role === "tool" && t.tool_call_id) results.set(t.tool_call_id, t)
  const visible = turns.filter((t) => t.role !== "tool")
  return (
    <ol className={cn("space-y-3", compact && "max-h-[520px] overflow-auto pr-1")}>
      {visible.map((t, i) => {
        const isUser = t.role === "user"
        return (
          <li key={i} className={cn("flex", isUser ? "justify-start" : "justify-end")}>
            <div className={cn("w-full max-w-[82%] space-y-2", isUser ? "" : "items-end")}>
              {t.content ? (
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed",
                    isUser
                      ? "rounded-tl-md bg-[#eef2f8] text-mm-dark"
                      : "rounded-tr-md border border-border/70 bg-white text-mm-dark",
                  )}
                >
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {isUser ? "Customer" : "Agent"}
                  </p>
                  <p className="whitespace-pre-wrap">{t.content}</p>
                </div>
              ) : null}
              {t.tool_calls?.length ? (
                <div className="space-y-1.5">
                  {t.tool_calls.map((c, j) => (
                    <ToolCallRow key={c.id ?? j} call={c} result={c.id ? results.get(c.id) : undefined} />
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ChangeRows({ changes }: { changes: DbChange[] }) {
  return (
    <table className="w-full text-left font-data text-[11.5px]">
      <tbody className="divide-y divide-border/60">
        {changes.map((c, i) => (
          <tr key={i} className="align-top">
            <td className="py-1.5 pr-3 text-mm-dark">{c.path}</td>
            <td className="py-1.5 text-muted-foreground">
              {c.change === "changed" ? (
                <>
                  <span className="line-through decoration-mm-orange/60">{short(c.from ?? "null", 60)}</span>
                  <span className="mx-1.5 text-border">→</span>
                  <span className="text-mm-dark">{short(c.to ?? "null", 90)}</span>
                </>
              ) : (
                <>
                  <span className={c.change === "added" ? "text-[#2f7a1f]" : "text-[#b34800]"}>{c.change}</span>{" "}
                  {short(c.value ?? "", 90)}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DatabaseChanges({ run }: { run: RunResult }) {
  const ev = asRecord(run.evaluation)
  const actual = run.db_changes ?? []
  const expected = (ev.expected_db_changes as DbChange[] | null | undefined) ?? null
  const showExpected = expected && ev.db_match === false
  if (!actual.length && !expected?.length) {
    return <p className="text-[13px] text-muted-foreground">The conversation left the database unchanged.</p>
  }
  return (
    <div className={cn("grid gap-4", showExpected && "lg:grid-cols-2")}>
      <div>
        {showExpected ? <p className="mb-2 text-[11px] font-medium text-muted-foreground">What the agent changed</p> : null}
        {actual.length ? <ChangeRows changes={actual} /> : <p className="text-[13px] text-muted-foreground">Nothing changed.</p>}
      </div>
      {showExpected ? (
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">What the reference solution changes</p>
          {expected!.length ? <ChangeRows changes={expected!} /> : <p className="text-[13px] text-muted-foreground">Nothing.</p>}
        </div>
      ) : null}
    </div>
  )
}

export function ConversationView({ run, compact }: { run: RunResult; compact?: boolean }) {
  const turns = run.conversation ?? []
  const H = compact ? "p" : "h3"
  const heading = compact
    ? "text-[12px] font-medium text-muted-foreground"
    : "text-[15px] font-semibold text-mm-dark"
  return (
    <div className="space-y-5">
      <EvaluationSummary run={run} />
      <div>
        <H className={heading}>Conversation</H>
        <div className="mt-3">
          <Transcript turns={turns} compact={compact} />
        </div>
      </div>
      <div>
        <H className={heading}>Database changes</H>
        <div className="mt-3">
          <DatabaseChanges run={run} />
        </div>
      </div>
    </div>
  )
}
