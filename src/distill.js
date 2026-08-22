/**
 * distill.js - Pioneer SLM perception.
 *
 * perceive.js answers "did something change" from the DOM: deterministic, free,
 * no key. It then guesses *what kind* of change by counting nodes, which is the
 * softest inference in the compiler. This replaces that guess with a real
 * classification from GLiNER2 - a ~300M-parameter encoder, $0.15/M tokens, one
 * forward pass for classification and NER together.
 *
 * Encoders take text, and perceive.js already emits text, so nothing here needs
 * a screenshot or a VLM. fal stays as the escalation tier for the cases the DOM
 * text genuinely cannot settle.
 *
 * Endpoint choice: POST /inference over POST /gliner-2. Both run the same base
 * model, and /gliner-2 has a higher rate limit (15k/min vs 5k), but /inference
 * returns `inference_id` - the handle POST /inferences/{id}/feedback needs - and
 * `latency_ms`. A compile is ~12 calls, so the rate limit is irrelevant and the
 * feedback handle is what makes Adaptive Inference reachable later. /inference
 * also accepts a fine-tuned training-job id in the same `model_id` slot, so the
 * upgrade from base model to LoRA checkpoint is one env var.
 *
 * Degrades to the heuristic when the key is absent. Never throws at the caller:
 * a dead classifier must not fail a compile.
 */
import { config, hasKey } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'

/** Same vocabulary perceive.js already uses, plus the one it cannot express. */
export const KINDS = ['creation', 'deletion', 'mutation', 'navigation', 'cosmetic']

/**
 * Three heads in one call. `state_change` replaces the node-count guess,
 * `destructive` feeds the confirm tier on emitted tools, and `entities` gives
 * domain nouns for tool naming - the job the heuristic does with a regex.
 */
export const PERCEPTION_SCHEMA = {
  classifications: [
    { task: 'state_change', labels: KINDS, multi_label: false, top_k: 1 },
    { task: 'destructive', labels: ['safe', 'destructive'], multi_label: false, top_k: 1 },
  ],
  entities: ['object_type', 'field_name'],
}

export function available() { return hasKey('pioneer') }

/**
 * What the classifier reads. Richer than describe()'s one-liner, because the
 * announcement text and the added/removed labels are the whole signal.
 */
export function perceptionText(action) {
  const e = action.evidence || {}
  const lines = [`action: "${action.label}" on ${action.seedUrl || e.from || '/'}`]
  if (e.added?.length) lines.push(`appeared: ${e.added.join(', ')}`)
  if (e.removed?.length) lines.push(`disappeared: ${e.removed.join(', ')}`)
  if (e.announced?.text) lines.push(`the app announced: "${e.announced.text}"`)
  lines.push(e.from !== e.to ? `navigated ${e.from} -> ${e.to}` : `url unchanged (${e.from || '/'})`)
  if (action.parameters?.length) lines.push(`form fields submitted: ${action.parameters.map((p) => p.label || p.name).join(', ')}`)
  return lines.join('\n')
}

/**
 * The documented response `result` is typed `object | array` with "format
 * depends on task", so the shape is not knowable from the spec. Rather than
 * bet on one, walk the object for the task name and accept any of the shapes
 * an encoder API plausibly returns. Unrecognised payloads are dumped to
 * out/pioneer-raw.json so one live run settles it.
 */
export function pickLabel(item, task) {
  const found = search(item, task)
  if (found == null) return null
  if (typeof found === 'string') return { label: found, confidence: null }

  if (Array.isArray(found)) {
    const scored = found
      .map((x) => (typeof x === 'string' ? { label: x, confidence: null } : { label: x.label ?? x.class ?? x.text, confidence: num(x.score ?? x.confidence) }))
      .filter((x) => x.label)
    if (!scored.length) return null
    return scored.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]
  }

  if (typeof found === 'object') {
    if (found.label || found.class) return { label: found.label ?? found.class, confidence: num(found.score ?? found.confidence) }
    // { creation: 0.91, mutation: 0.04 }
    const pairs = Object.entries(found).filter(([, v]) => typeof v === 'number')
    if (!pairs.length) return null
    const [label, confidence] = pairs.sort((a, b) => b[1] - a[1])[0]
    return { label, confidence }
  }
  return null
}

export function pickEntities(item) {
  const found = search(item, 'entities')
  if (!Array.isArray(found)) return []
  return found
    .map((e) => (typeof e === 'string' ? { text: e, label: null } : { text: e.text ?? e.span ?? e.value, label: e.label ?? e.type ?? null, confidence: num(e.score ?? e.confidence) }))
    .filter((e) => e.text)
}

const num = (v) => (typeof v === 'number' ? v : null)

/** Depth-first hunt for a key, so nesting under `result`/`classifications` is moot. */
function search(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (!Array.isArray(node)) {
    if (key in node) return node[key]
    // [{ task: 'state_change', label: 'creation' }] flattened into a parent list
    if (node.task === key) return node.label ?? node.labels ?? node.predictions ?? node
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = search(v, key, depth + 1)
    if (hit != null) return hit
  }
  return null
}

/** Batch inference is one request per compile, not one per step. */
export async function classify(texts) {
  const { base, model, threshold, timeoutMs } = config.pioneer
  const res = await fetch(`${base}/inference`, {
    method: 'POST',
    headers: { 'X-API-Key': config.keys.pioneer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: model, text: texts, schema: PERCEPTION_SCHEMA, threshold }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // 402/403 are billing, not transient - worth naming so nobody retries into a wall.
    const hint = res.status === 402 || res.status === 403 ? ' (credits exhausted - add credits at pioneer.ai)' : ''
    throw new Error(`pioneer HTTP ${res.status}${hint} ${detail.slice(0, 200)}`)
  }
  const body = await res.json()
  const items = Array.isArray(body.result) ? body.result : [body.result]
  return { items, meta: { inferenceId: body.inference_id, latencyMs: body.latency_ms, tokens: body.token_usage, modelUsed: body.model_used } }
}

/**
 * Enrich discovered actions with SLM perception, in place.
 *
 * Below the confidence threshold the heuristic answer stands and the step is
 * flagged for escalation - that is the whole cheap-model-with-an-escape-hatch
 * design, and the flag is what a fal tier would consume.
 */
export async function distill(actions, { log } = {}) {
  const stats = { source: 'heuristic', total: actions.length, confident: 0, escalate: 0, disagreed: 0, destructive: 0 }

  if (!actions.length) return stats
  if (!available()) {
    for (const a of actions) a.perception = { kind: a.effect, confidence: null, source: 'heuristic' }
    stats.reason = 'no PIONEER_API_KEY'
    return stats
  }

  let items, meta
  try {
    ;({ items, meta } = await classify(actions.map(perceptionText)))
  } catch (err) {
    for (const a of actions) a.perception = { kind: a.effect, confidence: null, source: 'heuristic' }
    stats.reason = err.message
    log?.(err.message)
    return stats
  }

  stats.source = 'pioneer'
  stats.model = meta.modelUsed || config.pioneer.model
  stats.latencyMs = meta.latencyMs
  stats.inferenceId = meta.inferenceId
  let unparsed = 0

  actions.forEach((action, i) => {
    const item = items[i] ?? items[0]
    const change = pickLabel(item, 'state_change')
    const risk = pickLabel(item, 'destructive')
    const entities = pickEntities(item)
    if (!change) unparsed++

    const confident = change && (change.confidence == null || change.confidence >= config.pioneer.threshold)
    const kind = confident && KINDS.includes(change.label) ? change.label : action.effect

    if (confident) stats.confident++
    else stats.escalate++
    if (change && kind !== action.effect) stats.disagreed++

    action.perception = {
      kind,
      confidence: change?.confidence ?? null,
      source: confident ? 'pioneer' : 'heuristic',
      heuristicKind: action.effect,
      // What a fal VLM tier would pick up. Nothing consumes it yet.
      escalate: !confident,
      entities,
      inferenceId: meta.inferenceId,
    }
    action.effect = kind
    if (risk?.label === 'destructive') { action.destructive = true; stats.destructive++ }
  })

  if (unparsed) {
    mkdirSync('out', { recursive: true })
    writeFileSync('out/pioneer-raw.json', JSON.stringify({ note: 'unrecognised result shape - teach pickLabel() this', body: items }, null, 2))
    stats.unparsed = unparsed
    log?.(`${unparsed}/${actions.length} results unparsed - raw shape written to out/pioneer-raw.json`)
  }
  return stats
}

/** One line for the compile log. */
export function summarise(s) {
  // Provider errors carry a full JSON body; a compile log is one line per stage.
  const why = s.reason ? s.reason.replace(/\s+/g, ' ').slice(0, 90) : ''
  if (s.source === 'heuristic') return `perception: heuristic${why ? ` (${why})` : ''} - SLM classifier idle`
  const bits = [`${s.confident}/${s.total} confident`]
  if (s.escalate) bits.push(`${s.escalate} to escalate`)
  if (s.disagreed) bits.push(`${s.disagreed} overruled the node count`)
  if (s.destructive) bits.push(`${s.destructive} destructive`)
  if (s.latencyMs != null) bits.push(`${Math.round(s.latencyMs)}ms`)
  return `perception: pioneer ${s.model} - ${bits.join(', ')}`
}
