/**
 * verify.js - a synthesised tool is a claim; executing it is the proof.
 *
 * synthesize.js emits a tool because the app announced a write once, with values
 * the explorer chose - one observation on one page state. Verification replays
 * the recipe cold, with arguments the app has never seen, and asks whether the
 * predicted effect is the effect that happened. Failures stay verified:false -
 * evidence about the compiler, not garbage - but only survivors reach the server.
 *
 * Two judges, mirroring perceive.js: a keyless diff judge that must always work,
 * and OpenAI structured output layered on top as a stricter second opinion.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'
import { config } from './config.js'
import { replay } from './replay.js'
import { emit } from './emit.js'
import { openSession, ensure, closeSession } from './session.js'

// replay.js gives the page 500ms to settle, a budget that fails once the target
// accumulates rows - which verifying is what does. Warm the route first.
const PACE_MS = Number(process.env.APIC_VERIFY_PACE_MS || 2500)
const OUT_DIR = process.env.APIC_OUT_DIR || 'generated'
const APP = process.env.APIC_APP || 'vikunja'
// config.js owns model choice; until it carries an openai block, read the env.
const MODEL = config.openai?.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini'

/** Fresh arguments every run: a tool that "passes" because the row it created
 *  last time is still on the page has proved nothing. */
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
    reason: { type: 'string', description: 'One sentence citing the evidence that decided it.' },
  }, required: ['verified', 'reason'], additionalProperties: false,
}

const SYSTEM = `You audit tools compiled by exploring a web app's UI, not by reading its API. A tool
was replayed live with arguments it had never seen. You get what it predicted and the DOM diff.
verified:true only on the app's own success announcement (a status or alert node); the submitted
value appearing in a node that is NOT the control it was typed into (a filter box redisplaying your
text is the field showing its own value, not a write); or disappearance - the ONLY evidence a delete
or a toggle can offer, since a delete removes the row rather than echoing it and a toggle swaps its
control for the inverse, so controlThisToolClicked inside removedDomNodes confirms the state flipped.
verified:false if nothing changed, if any argument never reached a field, or if the only evidence is
nodes appearing. A page that changed is not a write. Prefer false when the evidence is ambiguous.`

/** OpenAI judge. Reads the diff and rules on it. */
async function judgeModel(tool, args, result) {
  const client = new OpenAI({ apiKey: config.keys.openai, timeout: 30000 })
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: VERDICT } },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({
        tool: tool.name, description: tool.description,
        predictedEffect: tool.recipe.expect, argumentsSent: args,
        observed: {
          effect: result.effect,
          addedDomNodes: (result.added || []).filter((a) => !SELF.test(a)),
          addedNodesThatAreJustTheInputShowingItsOwnValue: (result.added || []).filter((a) => SELF.test(a)),
          removedDomNodes: result.removed || [],
          controlThisToolClicked: tool.provenance?.evidence?.control || tool.recipe.click || null,
          argumentsThatNeverReachedAField: result.unfilled || [],
          replayError: result.error,
        },
      }) },
    ],
  })
  const verdict = JSON.parse(res.choices[0].message.content)
  return { ...verdict, by: `openai/${MODEL}` }
}

/**
 * Keyless judge, in evidence order - never the effect label alone. Echo is
 * recomputed here because replay.js calls diff(before, after) without the
 * submitted value, leaving perceive.js's echoed() unreachable at replay time:
 * a creation that navigates comes back classified `navigation` and would fail
 * on effect equality despite having happened.
 */
const SUCCESS = /\b(success|successfully|created|saved|added|updated|deleted|removed)\b/i
// An echo inside the control we typed into is the field showing its own value.
const SELF = /^(input|textarea|select)\||\|(textbox|search|searchbox|combobox)\|/

function judgeDiff(tool, args, result) {
  const by = 'deterministic diff (no OPENAI_API_KEY - model judge skipped)'
  const added = result.added || []
  if (result.error) return { verified: false, reason: `replay threw: ${result.error}`, by }
  if (result.unfilled?.length) return { verified: false, reason: `arguments never reached a field: ${result.unfilled.join(', ')} - selectors have drifted`, by }
  if (!result.effect) return { verified: false, reason: 'the page did not change at all', by }

  // A drag has no banner and echoes nothing: the card already existed. Leaving
  // one column and arriving in another is evidence no re-render can produce.
  if (tool.recipe?.drag && tool.recipe.expect === 'relocation' && result.effect === 'relocation') {
    return { verified: true, reason: result.moved ? `the card relocated: ${result.moved}` : 'the card changed column', by }
  }

  // A deletion echoes nothing: the row it removed is by definition no longer on
  // the page, so net removal is the evidence. Both arrays are truncated to 3 by
  // replay, so their lengths mean nothing here - perceive() already established
  // net removal when it classified the effect, and that is what is trusted.
  if (tool.recipe?.expect === 'deletion' && result.effect === 'deletion') {
    if ((result.removed || []).length) {
      const r = result.removed
      return { verified: true, reason: `${r.length} node(s) removed with nothing replacing them: "${r[0].split('|').pop().slice(0, 50)}"`, by }
    }
  }

  // A toggle has nothing to echo: it swaps its own control for the inverse. The
  // control we clicked leaving the page is the app confirming the state flipped.
  const removed = result.removed || []
  const control = tool.provenance?.evidence?.control || tool.recipe?.click
  if (control && removed.some((r) => r.toLowerCase().includes(String(control).toLowerCase()))) {
    return { verified: true, reason: `the control it clicked ("${String(control).slice(0, 34)}") was replaced`, by }
  }

  const banner = added.find((a) => /\|(status|alert)\|/.test(a) && SUCCESS.test(a))
  if (banner) return { verified: true, reason: `the app announced it: "${banner.split('|').pop().replace(/\n/g, ' ').slice(0, 60)}"`, by }

  const echo = added.find((a) => !SELF.test(a) && Object.values(args).some((v) => typeof v === 'string' && v.length > 3 && a.includes(v)))
  const note = result.effect === result.expected ? '' : ` (replay called it ${result.effect}; it drops the value from diff())`
  if (echo) return { verified: true, reason: `the submitted value came back on the page${note}`, by }
  // Node counting alone is not proof. A page that changed is not a write.
  return { verified: false, reason: `observed ${result.effect} but nothing confirmed a write: no success banner, and no argument echoed outside the field it was typed into`, by }
}

export async function verifyAll(tools, { headless = true, log = () => {} } = {}) {
  const keyed = Boolean(config.keys.openai)
  const token = `v${Date.now().toString(36)}`
  const session = await openSession({ headless })
  const out = []
  try {
    await ensure(session)
    for (const [i, tool] of tools.entries()) {
      await session.page.goto(tool.recipe.seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await session.page.waitForTimeout(PACE_MS)
      const args = exampleArgs(tool, `${token}-${i}`)
      let result
      try { result = await replay(tool, args, { session }) }
      catch (e) { result = { ok: false, error: e.message?.split('\n')[0] || String(e) } }
      // The diff is the floor. The model may overturn a pass - a toast reading
      // "deleted" when creation was predicted - but never a rejection: it has been
      // caught citing the input's own echo as independent evidence.
      const floor = judgeDiff(tool, args, result)
      let verdict = floor
      if (keyed) {
        try {
          const m = await judgeModel(tool, args, result)
          verdict = m.verified && !floor.verified ? { ...floor, by: `${floor.by}; ${m.by} disagreed but cannot overturn a rejection` } : m
        } catch (e) { verdict = { ...floor, by: `fell back to diff: ${e.message?.split('\n')[0] || e}` } }
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
    const got = result.effect || (result.error ? 'error' : 'none')
    console.log(`  ${pad(tool.name, 20)} ${pad(tool.recipe.expect, 10)} ${pad(got, 10)} ${mark} ${verification.reason.slice(0, 70)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const toolsPath = join(OUT_DIR, APP, 'tools.json')
  const bundle = JSON.parse(readFileSync(toolsPath, 'utf8'))
  // Re-judge the rejects: a fix is meant to revive them.
  const pending = [...bundle.tools, ...(bundle.rejected || [])]
  const keyed = Boolean(config.keys.openai)
  console.log(`\n  apic verify -> ${bundle.target}`)
  console.log(`  judge: ${keyed ? `diff floor + openai ${MODEL} (structured output)` : '\x1b[33mdeterministic diff only - no OPENAI_API_KEY, degrading\x1b[0m'}`)
  console.log(`  ${pending.length} tools to replay with fresh arguments\n`)

  const rows = []
  const log = (row) => { rows.push(row); console.log(`    ${row.verification.verified ? '\x1b[32m*\x1b[0m' : '\x1b[31mx\x1b[0m'} ${row.tool.name}`) }
  const judged = await verifyAll(pending, { headless: !process.argv.includes('--headed'), log })

  const keep = judged.filter((t) => t.verification.verified)
  const drop = judged.filter((t) => !t.verification.verified)
  // emit() rewrites tools.json with whatever it is handed, so the server and
  // README are built from the survivors and the full record is written back after.
  emit(keep, { app: bundle.app, outDir: OUT_DIR, target: bundle.target })
  writeFileSync(toolsPath, JSON.stringify({ ...bundle, tools: keep, rejected: drop, verifiedAt: new Date().toISOString() }, null, 2))

  table(rows)
  console.log(`\n  ${keep.length}/${judged.length} verified -> ${join(OUT_DIR, APP)}/server.js serves ${keep.length}`)
  if (drop.length) console.log(`  ${drop.length} rejected, kept in tools.json under "rejected" with verified:false\n`)
}
