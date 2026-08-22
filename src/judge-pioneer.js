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
    // Descriptions quote the banner seen at compile time. Strip it: the
    // judge must read the replay's evidence, not the compile's.
    `tool: ${tool.name} - ${clip(String(tool.description || '').split(/\.?\s*Confirmed by the app/i)[0], 90)}`,
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

/** Batch: one request for every text. Throws on transport or HTTP failure. */
export async function classifyVerdicts(texts, { modelId = judgeModelId(), timeoutMs = config.pioneer.timeoutMs } = {}) {
  const res = await fetch(`${config.pioneer.base}/inference`, {
    method: 'POST',
    headers: { 'X-API-Key': config.keys.pioneer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, text: texts, schema: JUDGE_SCHEMA, threshold: 0, include_confidence: true, include_spans: false }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`pioneer HTTP ${res.status} ${detail.slice(0, 200)}`)
  }
  const body = await res.json()
  const items = Array.isArray(body.result) ? body.result : [body.result]
  return { verdicts: items.map(readVerdict), latencyMs: body.latency_ms, tokens: body.token_usage, modelUsed: body.model_used, raw: body, inferenceId: body.inference_id }
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
