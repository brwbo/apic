/**
 * judge-pioneer.js - the verify judge as a fine-tuned encoder.
 *
 * verify.js asks a general-purpose LLM (gpt-4.1-mini, ~200-word system prompt,
 * structured output) one narrow question per replay: given the DOM diff, did
 * the predicted write demonstrably happen? That is a two-label text
 * classification wearing a chat completion. This file answers the same
 * question with a GLiNER2 encoder fine-tuned on apic's own verify evidence -
 * one forward pass, no prompt, no generation.
 *
 * Same inputs, same vocabulary, same evidence ordering as judgeModel(), so the
 * two can be benchmarked head-to-head (pioneer-train.js bench). Degrades like
 * every stage: no key or no model id -> unavailable, and verify.js keeps its
 * existing judge.
 */
import { config, hasKey } from './config.js'
import { pickLabel } from './distill.js'

export const LABELS = ['verified', 'unverified']
// No multi_label/top_k keys: on the unified path they silently turn the
// result into {categories: []} (verified live 2026-08-22).
export const JUDGE_SCHEMA = { classifications: [{ task: 'verdict', labels: LABELS }] }

/** A completed training-job id. The base encoder has never seen this task. */
export function judgeModelId() { return (process.env.PIONEER_JUDGE_MODEL || '').trim() || null }
export function judgeAvailable() { return hasKey('pioneer') && Boolean(judgeModelId()) }

const SELF = /^(input|textarea|select)\||\|(textbox|search|searchbox|combobox)\|/
const clip = (s, n = 70) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const node = (s) => clip(String(s).split('|').slice(1).join(' ').trim() || s, 60)

/**
 * What the classifier reads. The same fields judgeModel() serialises as JSON,
 * rendered as labelled lines - encoders do better on prose-shaped text than on
 * braces, and the field names are the features.
 */
export function evidenceText(tool, args, result) {
  const added = result.added || [], removed = result.removed || []
  const strings = Object.values(args || {}).filter((v) => typeof v === 'string' && v.length > 3)
  const control = tool.provenance?.evidence?.control || tool.recipe?.click || null
  const lines = [
    // No tool name or description. With a handful of tools per app the name is
    // the strongest feature in the text, and the judge must generalise to tools
    // it has never seen - the held-out bench is split by tool for that reason.
    `predicted effect: ${tool.recipe?.expect || 'unknown'}`,
    `arguments sent: ${strings.length ? strings.map((s) => clip(s, 40)).join('; ') : 'none'}`,
    `observed effect: ${result.effect || (result.error ? 'error' : 'none')}`,
  ]
  if (result.error) lines.push(`replay error: ${clip(result.error, 80)}`)
  if (result.unfilled?.length) lines.push(`arguments that never reached a field: ${result.unfilled.join(', ')}`)
  const shown = added.filter((a) => !SELF.test(a)), self = added.filter((a) => SELF.test(a))
  lines.push(`nodes appeared (${shown.length}): ${shown.slice(0, 6).map(node).join(' | ') || 'none'}`)
  if (self.length) lines.push(`inputs showing their own value (${self.length}): ${self.slice(0, 3).map(node).join(' | ')}`)
  lines.push(`nodes removed (${removed.length}): ${removed.slice(0, 6).map(node).join(' | ') || 'none'}`)
  // The one fact judgeModel()'s system prompt spells out and an encoder has no
  // prompt to learn from: where the argument came back. A filter box redisplaying
  // what was typed is the field showing its own value, not a write.
  const inContent = strings.some((v) => shown.some((a) => a.includes(v)))
  const inInputs = strings.some((v) => self.some((a) => a.includes(v)))
  if (strings.length) lines.push(`argument echoed: ${inContent ? 'in page content' : inInputs ? 'only inside an input field' : 'nowhere'}`)
  lines.push(`control clicked: ${control ? clip(control, 50) : 'none'}`)
  if (result.moved) lines.push(`card moved: ${clip(result.moved, 60)}`)
  return lines.join('\n')
}

/** Accept whatever shape the deployed classifier returns for one text. */
export function readVerdict(item) {
  const hit = pickLabel(item, 'verdict') || pickLabel(item, 'categories') || pickLabel(item, 'classification') || pickLabel(item, 'label')
  if (!hit?.label) return null
  const label = String(hit.label).toLowerCase()
  if (!LABELS.includes(label)) return null
  return { label, confidence: hit.confidence }
}

/** One text, one request. Throws on transport or HTTP failure. */
export async function classifyOne(text, { modelId = judgeModelId(), timeoutMs = config.pioneer.timeoutMs, retries = 12 } = {}) {
  const res = await fetch(`${config.pioneer.base}/inference`, {
    method: 'POST',
    headers: { 'X-API-Key': config.keys.pioneer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, text, schema: JUDGE_SCHEMA, threshold: 0, include_confidence: true, include_spans: false }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  // 425: a freshly trained model is still "normalizing deployment artifacts".
  // Observed ~1-2 minutes after a job completes. Wait rather than fall back.
  if (res.status === 425 && retries > 0) {
    await new Promise((r) => setTimeout(r, 10000))
    return classifyOne(text, { modelId, timeoutMs, retries: retries - 1 })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`pioneer HTTP ${res.status} ${detail.slice(0, 200)}`)
  }
  const body = await res.json()
  return { verdict: readVerdict(Array.isArray(body.result) ? body.result[0] : body.result), latencyMs: body.latency_ms, tokens: body.token_usage, modelUsed: body.model_used, raw: body, inferenceId: body.inference_id }
}

/**
 * Many texts: one request each, a few in flight. NOT the API's batch form -
 * on a fine-tuned model, `text: [...]` returns labels that do not line up
 * with the inputs (12 texts: 6 wrong in batch, 2 wrong singly, same model,
 * same texts, 2026-08-22). Per-text is ~50ms server-side, so the cost is nil.
 */
export async function classifyVerdicts(texts, opts = {}) {
  const out = new Array(texts.length); let i = 0, latency = 0, tokens = 0, modelUsed
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, async () => {
    for (let k = i++; k < texts.length; k = i++) {
      const r = await classifyOne(texts[k], opts)
      out[k] = r.verdict; latency += r.latencyMs || 0; tokens += r.tokens || 0; modelUsed = r.modelUsed
    }
  }))
  return { verdicts: out, latencyMs: latency, tokens, modelUsed }
}

/** One judgement in verify.js's verdict shape. Throws so the caller can fall back. */
export async function judgePioneer(tool, args, result) {
  const text = evidenceText(tool, args, result)
  const { verdicts, latencyMs, modelUsed } = await classifyVerdicts([text])
  const v = verdicts[0]
  if (!v) throw new Error('pioneer returned no verdict label')
  const conf = v.confidence == null ? '' : ` (${Math.round(v.confidence * 100)}%)`
  return {
    verified: v.label === 'verified',
    reason: `fine-tuned encoder read the diff as ${v.label}${conf} in ${Math.round(latencyMs || 0)}ms`,
    by: `pioneer/${modelUsed || judgeModelId()}`,
    confidence: v.confidence, latencyMs,
  }
}
