/**
 * pioneer-train.js - fine-tune the verify judge on apic's own evidence.
 *
 *   node src/pioneer-train.js collect [--rounds N]   replay every tool N times, record evidence + verdict
 *   node src/pioneer-train.js dataset                 derive labelled negatives, split, write JSONL
 *   node src/pioneer-train.js upload                  push the training split to Pioneer
 *   node src/pioneer-train.js train                   create the training job, poll to completion
 *   node src/pioneer-train.js bench [--model JOB_ID]  held-out rows: GPT-4.1-mini vs the encoder
 *   node src/pioneer-train.js all                     collect -> dataset -> upload -> train -> bench
 *
 * Labels come from verify.js itself: the deterministic diff floor plus the
 * OpenAI judge, exactly what the product ships with today. The fine-tuned
 * encoder learns to reproduce that judgement without the LLM. Negatives are
 * derived from real rows by deleting the evidence the floor keys on - a row
 * with its banner removed, its echo moved into the input that typed it, its
 * argument marked unfilled - and relabelled by the same floor. No row is
 * labelled by hand and no label is invented.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { verifyAll, judgeDiff, judgeModel } from './verify.js'
import { evidenceText, classifyVerdicts, LABELS } from './judge-pioneer.js'

const OUT_DIR = process.env.APIC_OUT_DIR || 'generated'
const APP = process.env.APIC_APP || 'vikunja'
const DIR = 'out/pioneer'
const ROWS = join(DIR, 'evidence.jsonl')
const TRAIN = join(DIR, 'judge-train.jsonl')
const HELDOUT = join(DIR, 'judge-heldout.jsonl')
const STATE = join(DIR, 'state.json')
const DATASET = process.env.PIONEER_DATASET || 'apic-verify-judge'
const BASE = process.env.PIONEER_BASE_MODEL || 'fastino/gliner2-base-v1'

const flag = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt }
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const state = () => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const save = (patch) => { mkdirSync(DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify({ ...state(), ...patch }, null, 2)) }

async function api(path, init = {}) {
  const res = await fetch(`${config.pioneer.base}${path}`, {
    ...init, headers: { 'X-API-Key': config.keys.pioneer, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`)
  return body
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------------------------------------------------------- collect */
async function collect() {
  const rounds = Number(flag('rounds', 6))
  const bundle = JSON.parse(readFileSync(join(OUT_DIR, APP, 'tools.json'), 'utf8'))
  const tools = [...bundle.tools, ...(bundle.rejected || [])]
  mkdirSync(DIR, { recursive: true })
  console.log(`\n  collect: ${tools.length} tools x ${rounds} rounds against ${bundle.target}\n`)
  let n = 0
  for (let r = 0; r < rounds; r++) {
    const log = ({ tool, args, result, verification }) => {
      const row = { app: APP, tool: tool.name, text: evidenceText(tool, args, result), label: verification.verified ? 'verified' : 'unverified',
        by: verification.by, source: 'replay', round: r, slim: slimTool(tool), args, result: slimResult(result) }
      appendFileSync(ROWS, JSON.stringify(row) + '\n'); n++
      console.log(`    r${r} ${verification.verified ? '\x1b[32m*\x1b[0m' : '\x1b[31mx\x1b[0m'} ${tool.name}`)
    }
    await verifyAll(tools, { headless: !process.argv.includes('--headed'), log })
  }
  console.log(`\n  ${n} rows appended -> ${ROWS} (${readJsonl(ROWS).length} total)`)
}
const slimTool = (t) => ({ name: t.name, description: t.description, recipe: { expect: t.recipe?.expect, click: t.recipe?.click, drag: t.recipe?.drag }, provenance: { evidence: { control: t.provenance?.evidence?.control } } })
const slimResult = (r) => ({ effect: r.effect, expected: r.expected, added: r.added, removed: r.removed, unfilled: r.unfilled, error: r.error, moved: r.moved })

/* ---------------------------------------------------------------- dataset */
const SELF_TAG = 'input|textbox|'
/** Evidence deletions. Each returns a new result, or null if it would not change anything. */
const PERTURB = {
  nothing_changed: (r) => ({ ...r, effect: null, added: [], removed: [], moved: undefined }),
  no_proof: (r) => r.added?.length ? { ...r, added: r.added.filter((a) => !/\|(status|alert)\|/.test(a) && !/success|created|saved|added|updated|deleted|removed/i.test(a)), removed: [], moved: undefined } : null,
  echo_in_own_input: (r, args) => {
    const strings = Object.values(args).filter((v) => typeof v === 'string' && v.length > 3)
    if (!strings.length || !r.added?.length) return null
    return { ...r, added: r.added.map((a) => strings.some((s) => a.includes(s)) ? `${SELF_TAG}${a.split('|').pop()}` : a).filter((a) => !/\|(status|alert)\|/.test(a)), removed: [] }
  },
  unfilled_argument: (r, args) => { const k = Object.keys(args)[0]; return k ? { ...r, unfilled: [k] } : null },
  replay_threw: (r) => ({ ...r, error: 'Timeout 30000ms exceeded waiting for selector', effect: null, added: [], removed: [] }),
}
/**
 * Label-preserving: the `apic <field> <token>` arguments become values a person
 * would type, in the args and in every node that echoed them. Same evidence,
 * different surface, so the encoder learns "the value came back", not the token.
 */
const VALUES = ['Q3 roadmap review', 'Fix login redirect', 'Renew domain', 'Design sync notes', 'Invoice #2291', 'Urgent', 'Backend', 'Onboarding']
function renameArgs(args, result, i) {
  const map = {}; let k = i
  for (const [key, v] of Object.entries(args)) if (typeof v === 'string' && v.startsWith('apic ')) map[v] = `${VALUES[k++ % VALUES.length]} ${key.slice(0, 3)}`
  if (!Object.keys(map).length) return null
  const sub = (s) => Object.entries(map).reduce((acc, [from, to]) => acc.split(from).join(to), s)
  return { args: Object.fromEntries(Object.entries(args).map(([key, v]) => [key, typeof v === 'string' ? sub(v) : v])),
    result: { ...result, added: (result.added || []).map(sub), removed: (result.removed || []).map(sub), moved: result.moved ? sub(result.moved) : result.moved } }
}

function dataset() {
  const real = readJsonl(ROWS)
  if (!real.length) throw new Error(`no rows in ${ROWS} - run collect first`)
  const rows = []
  real.forEach((row, i) => {
    const tool = row.slim
    // The real row, re-rendered (evidenceText may have changed since collect) and
    // a renamed twin of it carrying the same label.
    const variants = [{ args: row.args, result: row.result, source: 'replay', label: row.label }]
    const twin = renameArgs(row.args, row.result, i)
    if (twin) variants.push({ ...twin, source: 'replay:renamed', label: row.label })
    for (const v of variants) {
      rows.push({ text: evidenceText(tool, v.args, v.result), label: v.label, tool: row.tool, source: v.source, slim: tool, args: v.args, result: v.result })
      for (const [name, fn] of Object.entries(PERTURB)) {
        const mutated = fn(v.result, v.args)
        if (!mutated) continue
        const floor = judgeDiff(tool, v.args, mutated)
        rows.push({ text: evidenceText(tool, v.args, mutated), label: floor.verified ? 'verified' : 'unverified', tool: row.tool, source: `perturb:${name}`, slim: tool, args: v.args, result: mutated })
      }
    }
  })
  // Dedupe on text, then hold out by tool so the bench measures generalisation
  // to evidence shapes, not memorised strings.
  const seen = new Set(); const uniq = rows.filter((r) => !seen.has(r.text) && seen.add(r.text))
  const tools = [...new Set(uniq.map((r) => r.tool))]
  const holdTools = new Set(tools.filter((_, i) => i % 4 === 3))
  const train = uniq.filter((r) => !holdTools.has(r.tool)), held = uniq.filter((r) => holdTools.has(r.tool))
  mkdirSync(DIR, { recursive: true })
  writeFileSync(TRAIN, train.map((r) => JSON.stringify({ text: r.text, label: r.label })).join('\n') + '\n')
  writeFileSync(HELDOUT, held.map((r) => JSON.stringify(r)).join('\n') + '\n')
  const count = (xs, l) => xs.filter((r) => r.label === l).length
  console.log(`\n  dataset: ${real.length} real rows -> ${uniq.length} unique`)
  console.log(`  train   ${train.length}  (verified ${count(train, 'verified')} / unverified ${count(train, 'unverified')}) -> ${TRAIN}`)
  console.log(`  heldout ${held.length}  (verified ${count(held, 'verified')} / unverified ${count(held, 'unverified')}) tools: ${[...holdTools].join(', ')} -> ${HELDOUT}`)
  save({ trainRows: train.length, heldoutRows: held.length, heldoutTools: [...holdTools] })
}

/* ----------------------------------------------------------------- upload */
async function upload() {
  const body = readFileSync(TRAIN, 'utf8')
  const res = await api('/felix/datasets/upload/url', { method: 'POST', body: JSON.stringify({
    dataset_name: DATASET, dataset_type: 'classification', format: 'jsonl', filename: 'judge-train.jsonl',
    type: 'training', generation_type: 'upload', column_mapping: { text: 'text', label: 'label' } }) })
  console.log(`\n  upload: dataset ${res.dataset_name} v${res.version_number} (${res.dataset_id})`)
  const put = await fetch(res.presigned_url, { method: 'PUT', body, headers: { 'Content-Type': 'application/octet-stream' } })
  if (!put.ok) throw new Error(`presigned PUT -> ${put.status} ${(await put.text()).slice(0, 200)}`)
  await api('/felix/datasets/upload/process', { method: 'POST', body: JSON.stringify({ dataset_id: res.dataset_id }) })
  for (let i = 0; i < 60; i++) {
    const v = await api(`/felix/datasets/${encodeURIComponent(res.dataset_name)}/${encodeURIComponent(res.version_number)}`)
    const d = v.dataset || v.version || v
    process.stdout.write(`\r  status: ${d.status}${d.sample_size ? ` (${d.sample_size} rows)` : ''}      `)
    if (d.status === 'ready') { console.log(); save({ dataset: res.dataset_name, datasetVersion: res.version_number, datasetId: res.dataset_id }); return }
    if (d.status === 'failed') throw new Error(`dataset failed: ${d.processing_error}`)
    await sleep(3000)
  }
  throw new Error('dataset never became ready')
}

/* ------------------------------------------------------------------ train */
async function train() {
  const s = state()
  if (!s.dataset) throw new Error('no dataset in state - run upload first')
  const job = await api('/felix/training-jobs', { method: 'POST', body: JSON.stringify({
    model_name: `apic-verify-judge-${Date.now().toString(36)}`,
    datasets: [{ name: s.dataset, version: s.datasetVersion }],
    base_model: BASE, training_type: process.env.PIONEER_TRAINING_TYPE || 'full',
    validation_data_percentage: 0.15, nr_epochs: Number(process.env.PIONEER_EPOCHS || 12),
    early_stopping_patience: 3, min_training_steps: 100,
  }) })
  console.log(`\n  train: job ${job.id} (${job.status}) on ${BASE}`)
  save({ job: job.id, modelName: job.model_name })
  const started = Date.now()
  for (;;) {
    const j = await api(`/felix/training-jobs/${job.id}`)
    process.stdout.write(`\r  ${Math.round((Date.now() - started) / 1000)}s  status: ${j.status}${j.normalized_status ? ` (${j.normalized_status})` : ''}      `)
    if (j.is_terminal_status || ['complete', 'deployed', 'errored', 'failed', 'completed'].includes(String(j.normalized_status || j.status).toLowerCase())) {
      console.log()
      if (/err|fail/i.test(j.normalized_status || j.status)) throw new Error(`training failed: ${j.error_message}`)
      await deploy(job.id)
      console.log(`\n  done. Set PIONEER_JUDGE_MODEL=${job.id}`)
      save({ judgeModel: job.id })
      return job.id
    }
    await sleep(10000)
  }
}

/** Inference wants a deployed checkpoint. Try a probe first; deploy only if it refuses. */
async function deploy(jobId) {
  try { await classifyVerdicts(['probe'], { modelId: jobId }); return }
  catch (e) { console.log(`  probe: ${e.message.slice(0, 120)} - deploying a checkpoint`) }
  const cps = await api(`/felix/training-jobs/${jobId}/checkpoints`)
  const list = cps.checkpoints || cps
  const cp = Array.isArray(list) && list.length ? list[list.length - 1] : null
  if (!cp) { console.log('  no checkpoints listed; inference may still warm up'); return }
  const r = await api(`/felix/training-jobs/${jobId}/checkpoints/${cp.id || cp.checkpoint_id}/deploy`, { method: 'POST' })
  console.log(`  deployed: ${r.message}`)
  for (let i = 0; i < 30; i++) {
    try { await classifyVerdicts(['probe'], { modelId: jobId }); return } catch { await sleep(10000) }
  }
}

/* ------------------------------------------------------------------ bench */
async function bench() {
  const modelId = flag('model', state().judgeModel || process.env.PIONEER_JUDGE_MODEL)
  if (!modelId) throw new Error('no model id - pass --model JOB_ID or run train')
  const held = readJsonl(HELDOUT)
  if (!held.length) throw new Error('no held-out rows - run dataset first')
  console.log(`\n  bench: ${held.length} held-out rows, tools never seen in training\n`)

  // Encoder: batches of 16, wall-clock measured client-side like the LLM.
  const enc = [], encT = Date.now(); let encTokens = 0
  for (let i = 0; i < held.length; i += 16) {
    const chunk = held.slice(i, i + 16)
    const r = await classifyVerdicts(chunk.map((h) => h.text), { modelId })
    encTokens += r.tokens || 0
    r.verdicts.forEach((v, k) => enc.push({ ...chunk[k], pred: v?.label || null, conf: v?.confidence }))
  }
  const encMs = Date.now() - encT

  // LLM: the same rows through verify.js's own judgeModel(), unchanged - it
  // sees the tool, the arguments and the diff exactly as it does in production.
  const llm = [], llmT = Date.now()
  const keyed = Boolean(config.keys.openai)
  if (keyed) for (const h of held) {
    try { const v = await judgeModel(h.slim, h.args, h.result); llm.push({ ...h, pred: v.verified ? 'verified' : 'unverified' }) }
    catch (e) { llm.push({ ...h, pred: null, err: e.message }) }
  }
  const llmMs = Date.now() - llmT

  const score = (rows) => {
    const ok = rows.filter((r) => r.pred === r.label).length
    const tp = rows.filter((r) => r.pred === 'verified' && r.label === 'verified').length
    const fp = rows.filter((r) => r.pred === 'verified' && r.label !== 'verified').length
    const fn = rows.filter((r) => r.pred !== 'verified' && r.label === 'verified').length
    return { acc: ok / rows.length, precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), fp, fn, none: rows.filter((r) => !r.pred).length }
  }
  const pct = (x) => `${(x * 100).toFixed(1)}%`
  const report = { heldout: held.length, model: modelId, encoder: { ...score(enc), wallMs: encMs, perRowMs: Math.round(encMs / held.length), tokens: encTokens },
    llm: keyed ? { ...score(llm), wallMs: llmMs, perRowMs: Math.round(llmMs / held.length), model: 'gpt-4.1-mini' } : null, at: new Date().toISOString() }
  console.log(`  ${'judge'.padEnd(28)} acc      prec     recall   fp  fn  ms/row`)
  console.log(`  ${'-'.repeat(70)}`)
  const line = (name, s) => console.log(`  ${name.padEnd(28)} ${pct(s.acc).padEnd(8)} ${pct(s.precision).padEnd(8)} ${pct(s.recall).padEnd(8)} ${String(s.fp).padEnd(3)} ${String(s.fn).padEnd(3)} ${s.perRowMs}`)
  line(`pioneer gliner2 fine-tune`, report.encoder)
  if (report.llm) line(`openai gpt-4.1-mini`, report.llm)
  const miss = enc.filter((r) => r.pred !== r.label)
  if (miss.length) { console.log(`\n  encoder misses (${miss.length}):`); for (const m of miss.slice(0, 8)) console.log(`    ${m.tool} [${m.source}] label=${m.label} pred=${m.pred}${m.conf != null ? ` ${Math.round(m.conf * 100)}%` : ''}`) }
  writeFileSync(join(DIR, 'bench.json'), JSON.stringify({ ...report, rows: enc.map((r, i) => ({ tool: r.tool, source: r.source, label: r.label, encoder: r.pred, conf: r.conf, llm: llm[i]?.pred ?? null })) }, null, 2))
  console.log(`\n  -> ${join(DIR, 'bench.json')}`)
}

/* -------------------------------------------------------------------- cli */
const cmd = process.argv[2]
const steps = { collect, dataset, upload, train, bench }
if (!config.keys.pioneer && cmd !== 'collect' && cmd !== 'dataset') { console.error('  PIONEER_API_KEY missing'); process.exit(1) }
if (cmd === 'all') { await collect(); dataset(); await upload(); await train(); await bench() }
else if (steps[cmd]) await steps[cmd]()
else { console.log('usage: pioneer-train.js collect|dataset|upload|train|bench|all'); process.exit(1) }
