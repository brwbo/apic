/**
 * verify.js - a synthesised tool is a claim; executing it is the proof.
 *
 * synthesize.js emits a tool because the app announced a write once, during
 * exploration, with values the explorer chose. That is one observation on one
 * page state. Verification replays the recipe cold, with arguments the app has
 * never seen, and asks whether the effect the tool predicts is the effect that
 * actually happened. Tools that fail stay in tools.json marked verified:false -
 * a rejected tool is evidence about the compiler, not garbage - but only the
 * survivors are emitted into the server.
 *
 * Two judges behind one interface, mirroring perceive.js:
 *   model   - OpenAI structured output. Reads the diff and rules on it.
 *   diff    - keyless. `expected === observed && every argument landed`.
 * The keyless rung must keep working; it is the one the demo can always run.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'
import { config } from './config.js'
import { replay } from './replay.js'
import { emit } from './emit.js'
import { openSession, ensure, closeSession } from './session.js'

// Vikunja rate limits, and a verifier that trips the limit invents failures
// that look exactly like UI drift - the precise signal this stage exists to
// produce honestly. Pace the replays; a slow verify is worth a truthful one.
const PACE_MS = Number(process.env.APIC_VERIFY_PACE_MS || 1500)
const OUT_DIR = process.env.APIC_OUT_DIR || 'generated'
const APP = process.env.APIC_APP || 'vikunja'
// config.js owns model choice; until it carries an openai block this reads the
// env directly rather than hard-coding a model name in two places.
const MODEL = config.openai?.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini'

/**
 * Fresh arguments on every run. A tool that "passes" because the row it created
 * last time is still on the page has proved nothing, so every string carries a
 * token unique to this run and this tool.
 */
function exampleArgs(tool, token) {
  const { properties = {} } = tool.inputSchema || {}
  const args = {}
  for (const [k, spec] of Object.entries(properties)) {
    if (k === 'confirm' || spec.type === 'boolean') args[k] = true
    else if (spec.type === 'number' || spec.type === 'integer') args[k] = 7
    else args[k] = `apic ${k} ${token}`
  }
  return args
}

const VERDICT = {
  type: 'object',
  properties: {
    verified: { type: 'boolean', description: 'True only if the predicted effect demonstrably occurred.' },
    reason: { type: 'string', description: 'One sentence citing the specific evidence that decided it.' },
  },
  required: ['verified', 'reason'],
  additionalProperties: false,
}

const SYSTEM = `You audit tools that were compiled by exploring a web app's UI, not by reading its API.
A tool was replayed against the live app with arguments it had never seen. You are given what the
tool predicted would happen and the DOM diff of what did happen.
Rule verified:true only if the predicted effect demonstrably occurred - typically the submitted
argument value appearing in the added DOM nodes, or the app's own success announcement.
Rule verified:false if nothing changed, if the change is a different kind of effect, if the diff is
only navigation or re-render, or if any argument failed to reach a field. A page that changed is not
a write that happened. Prefer false when the evidence is ambiguous.`

/** OpenAI judge. Reads the diff and rules on it. */
async function judgeModel(tool, args, result) {
  const client = new OpenAI({ apiKey: config.keys.openai, timeout: 30000 })
  const res = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: VERDICT } },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          tool: tool.name,
          description: tool.description,
          predictedEffect: tool.recipe.expect,
          clicked: tool.recipe.click,
          argumentsSent: args,
          observed: {
            effect: result.effect,
            anythingChanged: result.ok || result.effect !== undefined,
            addedDomNodes: result.added || [],
            argumentsThatNeverReachedAField: result.unfilled || [],
            replayError: result.error,
          },
        }),
      },
    ],
  })
  const verdict = JSON.parse(res.choices[0].message.content)
  return { ...verdict, by: `openai/${MODEL}` }
}

/**
 * Keyless judge. Deliberately strict: the recipe predicted an effect, so the
 * observed effect must match it and every argument must have landed. Submitting
 * a form without setting its arguments is the failure that looks like success.
 */
function judgeDiff(tool, args, result) {
  const by = 'deterministic diff (no OPENAI_API_KEY - model judge skipped)'
  if (result.error) return { verified: false, reason: `replay threw: ${result.error}`, by }
  if (result.unfilled?.length) return { verified: false, reason: `arguments never reached a field: ${result.unfilled.join(', ')} - selectors have drifted`, by }
  if (!result.effect) return { verified: false, reason: 'the page did not change at all', by }
  if (result.effect !== result.expected) return { verified: false, reason: `predicted ${result.expected}, observed ${result.effect}`, by }
  if (!result.ok) return { verified: false, reason: `observed ${result.effect} but the diff was empty`, by }
  const echo = (result.added || []).find((a) => Object.values(args).some((v) => typeof v === 'string' && a.includes(v)))
  return {
    verified: true,
    reason: echo ? `observed ${result.effect}; the submitted value came back on the page` : `observed ${result.effect} as predicted`,
    by,
  }
}

export async function verifyAll(tools, { headless = true, log = () => {} } = {}) {
  const keyed = Boolean(config.keys.openai)
  const token = `v${Date.now().toString(36)}`
  const session = await openSession({ headless })
  const out = []
  try {
    await ensure(session)
    for (const [i, tool] of tools.entries()) {
      if (i) await new Promise((r) => setTimeout(r, PACE_MS))
      const args = exampleArgs(tool, `${token}-${i}`)
      let result
      try {
        result = await replay(tool, args, { session })
      } catch (e) {
        result = { ok: false, error: e.message?.split('\n')[0] || String(e) }
      }
      let verdict
      try {
        verdict = keyed ? await judgeModel(tool, args, result) : judgeDiff(tool, args, result)
      } catch (e) {
        // A judge that is down must not fail a tool on the judge's behalf.
        verdict = { ...judgeDiff(tool, args, result), by: `fell back to diff: ${e.message?.split('\n')[0] || e}` }
      }
      const verification = { verified: verdict.verified, reason: verdict.reason, at: new Date().toISOString(), by: verdict.by }
      out.push({ ...tool, verification })
      log({ tool, args, result, verification })
    }
  } finally { await closeSession(session) }
  return out
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n)

function table(rows) {
  console.log(`\n  ${pad('tool', 20)} ${pad('expect', 10)} ${pad('got', 10)} ${pad('', 4)} reason`)
  console.log(`  ${'-'.repeat(78)}`)
  for (const { tool, result, verification } of rows) {
    const mark = verification.verified ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
    console.log(`  ${pad(tool.name, 20)} ${pad(tool.recipe.expect, 10)} ${pad(result.effect || result.error ? result.effect || 'error' : 'none', 10)} ${mark} ${verification.reason.slice(0, 70)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const toolsPath = join(OUT_DIR, APP, 'tools.json')
  const bundle = JSON.parse(readFileSync(toolsPath, 'utf8'))
  const keyed = Boolean(config.keys.openai)
  console.log(`\n  apic verify -> ${bundle.target}`)
  console.log(`  judge: ${keyed ? `openai ${MODEL} (structured output)` : '\x1b[33mdeterministic diff - no OPENAI_API_KEY, degrading\x1b[0m'}`)
  console.log(`  ${bundle.tools.length} tools to replay with fresh arguments\n`)

  const rows = []
  const judged = await verifyAll(bundle.tools, {
    headless: !process.argv.includes('--headed'),
    log: (row) => { rows.push(row); console.log(`    ${row.verification.verified ? '\x1b[32m*\x1b[0m' : '\x1b[31mx\x1b[0m'} ${row.tool.name}`) },
  })

  const keep = judged.filter((t) => t.verification.verified)
  const drop = judged.filter((t) => !t.verification.verified)

  // emit() rewrites tools.json with whatever it is handed, so the server and
  // README are built from the survivors and the full record is written back
  // afterwards. Rejected tools keep their verdict; they just are not served.
  emit(keep, { app: bundle.app, outDir: OUT_DIR, target: bundle.target })
  writeFileSync(toolsPath, JSON.stringify({ ...bundle, tools: keep, rejected: drop, verifiedAt: new Date().toISOString() }, null, 2))

  table(rows)
  console.log(`\n  ${keep.length}/${judged.length} verified -> ${join(OUT_DIR, APP)}/server.js serves ${keep.length}`)
  if (drop.length) console.log(`  ${drop.length} rejected, kept in tools.json under "rejected" with verified:false`)
  console.log()
}
