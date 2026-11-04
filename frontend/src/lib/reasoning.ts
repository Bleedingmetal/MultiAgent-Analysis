/**
 * Turn an agent's free-text output into something a non-technical reader can follow:
 * the reasoning as discrete steps, the FinQA program (if any), and the final answer.
 */

export type AgentOutput = {
  steps: string[]
  program: string | null
  finalAnswer: string | null
  /** Text that was neither reasoning nor answer (e.g. a JSON envelope or a bare response). */
  remainder: string | null
}

const STEP_MARKER = /(?:^|\n)\s*(?:step\s*)?\d{1,2}[.):]\s+/gi
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z$(\d-])/

function clean(text: string) {
  // Markdown emphasis and headings add nothing when the text is laid out as steps
  return text.replace(/\*\*|__|^#+\s*/gm, "").trim()
}

/** Split reasoning prose into steps: numbered lines first, then lines, then sentences. */
export function parseReasoningSteps(text: string | null | undefined): string[] {
  const source = clean(text ?? "")
  if (!source) return []

  const markers = [...source.matchAll(STEP_MARKER)]
  if (markers.length >= 2) {
    const steps: string[] = []
    const lead = source.slice(0, markers[0].index).trim()
    if (lead) steps.push(lead)
    markers.forEach((m, i) => {
      const start = (m.index ?? 0) + m[0].length
      const end = i + 1 < markers.length ? markers[i + 1].index : source.length
      const step = source.slice(start, end).trim()
      if (step) steps.push(step)
    })
    return steps
  }

  const lines = source
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s+/, "").trim())
    .filter(Boolean)
  if (lines.length >= 2) return lines

  const sentences = source.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)
  if (sentences.length <= 8) return sentences
  // Very long prose: fold into at most 8 steps of consecutive sentences
  const per = Math.ceil(sentences.length / 8)
  const folded: string[] = []
  for (let i = 0; i < sentences.length; i += per) {
    folded.push(sentences.slice(i, i + per).join(" "))
  }
  return folded
}

/** Pull the Reasoning / Program / Final answer sections out of a raw model response. */
export function parseAgentOutput(raw: string | null | undefined): AgentOutput {
  const text = clean(raw ?? "")
  if (!text) return { steps: [], program: null, finalAnswer: null, remainder: null }

  let body = text
  let finalAnswer: string | null = null
  let program: string | null = null

  const answerMatch = body.match(/(?:^|\n)\s*(?:final\s*answer|answer)\s*:\s*([^\n]+)\s*$/i)
  if (answerMatch) {
    finalAnswer = answerMatch[1].trim().replace(/\.$/, "")
    body = body.slice(0, answerMatch.index).trim()
  }
  const programMatch = body.match(/(?:^|\n)\s*program\s*:\s*([^\n]+)/i)
  if (programMatch) {
    program = programMatch[1].trim()
    body = (body.slice(0, programMatch.index) + body.slice((programMatch.index ?? 0) + programMatch[0].length)).trim()
  }
  body = body.replace(/^\s*(?:reasoning|thought\s*process|scratch\s*work)\s*:\s*/i, "").trim()

  // A JSON envelope (structured chain steps) is not prose: hand it back whole
  if (/^[[{]/.test(body)) {
    return { steps: [], program, finalAnswer, remainder: body }
  }
  return { steps: parseReasoningSteps(body), program, finalAnswer, remainder: null }
}

/** True when a step is mostly arithmetic, so it can be set in a figure face. */
export function isCalculationStep(step: string) {
  const numbers = step.match(/\d[\d,]*(?:\.\d+)?/g)?.length ?? 0
  return /[=×÷]/.test(step) && numbers >= 2
}
