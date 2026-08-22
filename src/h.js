/**
 * h.js - the computer-use planner, backed by h's Holo models.
 *
 * Why not the hosted Agent Platform (POST agp.eu.hcompany.ai/api/v2/sessions)?
 * That runs the browser on h's own infrastructure - there is no bring-your-own
 * browser or CDP endpoint - so it cannot reach a Vikunja on localhost. Holo's
 * inference endpoint is OpenAI-compatible, so we keep our local browser and put
 * h's model where the decision actually is: choosing the next action from a
 * screenshot. Same partner technology, and it works against a private target.
 *
 * This is the `model` planner that plan.js documents. The heuristic planner
 * stays the fallback: no key, a refusal or a bad response falls back rather
 * than failing the compile.
 */
import 'dotenv/config' // h.js is imported directly by doctor and plan; never assume config.js loaded first
import OpenAI from 'openai'

const BASE_URL = process.env.HAI_MODEL_URL || 'https://api.hcompany.ai/v1'
const MODEL = process.env.HAI_MODEL_NAME || 'holo3-1-35b-a3b'

export function available() {
  return Boolean(process.env.HAI_API_KEY)
}

export function describeConfig() {
  return { baseUrl: BASE_URL, model: MODEL, keyed: available() }
}

function client() {
  return new OpenAI({ apiKey: process.env.HAI_API_KEY, baseURL: BASE_URL, timeout: 30000 })
}

const SYSTEM = `You are exploring a web application to discover what WRITE actions it exposes.
You are not completing a task - you are mapping capability, the way a compiler parses a source file.
Prefer actions that create, rename, assign, move or complete things.
Avoid navigation that only changes the view, and avoid destructive actions unless nothing else is left.
Reply with JSON only: {"label": "<exact label from the candidate list>", "why": "<8 words or fewer>", "done": false}
Set "done": true only when every candidate worth trying has been tried.`

/**
 * Choose the next affordance to try. Returns null when h is unavailable or
 * gives an unusable answer, which means "fall back to the heuristic ranker".
 */
export async function nextAction(page, { goal, candidates, tried = [] }) {
  if (!available() || !candidates?.length) return null

  const remaining = candidates.filter((c) => !tried.includes(c))
  if (!remaining.length) return null

  let shot
  try {
    shot = (await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false })).toString('base64')
  } catch { return null }

  const prompt = [
    `Goal: ${goal}`,
    `Current URL: ${page.url()}`,
    tried.length ? `Already tried: ${tried.join(', ')}` : 'Nothing tried yet.',
    `Candidates:\n${remaining.map((c) => `- ${c}`).join('\n')}`,
  ].join('\n\n')

  let raw
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } },
          ],
        },
      ],
    })
    raw = res.choices?.[0]?.message?.content ?? ''
  } catch (e) {
    // Quota, wrong HAI_MODEL_URL, cold model - none of these should stop a compile.
    return { error: e.message?.split('\n')[0] || String(e) }
  }

  const parsed = parseJson(raw)
  if (!parsed?.label) return null

  // The model must pick from the list; anything else is a hallucinated affordance.
  const label = remaining.find((c) => c === parsed.label)
    || remaining.find((c) => c.toLowerCase() === String(parsed.label).toLowerCase())
  if (!label) return null

  return { label, why: String(parsed.why || '').slice(0, 60), done: Boolean(parsed.done) }
}

/** Tolerate fenced or chatty responses around the JSON. */
function parseJson(text) {
  if (!text) return null
  const body = text.replace(/```(?:json)?/g, '').trim()
  try { return JSON.parse(body) } catch { /* try to find an object */ }
  const m = body.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** One cheap call, to prove the key and the endpoint before a compile depends on them. */
export async function check() {
  if (!available()) return { ok: false, reason: 'HAI_API_KEY not set' }
  try {
    const res = await client().chat.completions.create({
      model: MODEL,
      max_tokens: 5,
      messages: [{ role: 'user', content: 'reply with OK' }],
    })
    return { ok: true, model: MODEL, baseUrl: BASE_URL, said: res.choices?.[0]?.message?.content?.trim() }
  } catch (e) {
    return { ok: false, reason: e.message?.split('\n')[0] || String(e), model: MODEL, baseUrl: BASE_URL }
  }
}
