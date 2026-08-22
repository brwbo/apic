/**
 * synthesize-read.js - decide what the strings in a card MEAN.
 *
 * Everything discover-read.js does is deterministic: it finds repeated
 * structure and records selectors that resolve. What it cannot settle is
 * semantics - "4.6" is a rating, "0.5 mi" is a distance, "\u00b7" is a separator
 * and not a column at all - and no heuristic over a DOM tells them apart.
 * So the model goes in exactly here, once per collection, over three sample
 * rows, and its answer is filtered against selectors that were actually
 * observed. It names things; it never gets to claim anything exists.
 */
import OpenAI from 'openai'
import { config } from './config.js'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

const ROW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['toolName', 'description', 'fields'],
  properties: {
    toolName: { type: 'string' },
    description: { type: 'string' },
    fields: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'selector', 'attr', 'description', 'required'],
        properties: {
          name: { type: 'string' },
          selector: { type: 'string' },
          attr: { type: ['string', 'null'] },
          description: { type: 'string' },
          required: { type: 'boolean' },
        },
      },
    },
  },
}

const SYSTEM = `You are compiling a web page's repeated card structure into a typed row schema.
You are given up to 3 sample rows. Each sample is a list of candidate columns: a CSS selector
relative to the row, and the text (or href) that selector currently yields.

Return one field per MEANINGFUL column, naming it in camelCase for what it MEANS (name, price,
rating, ratingCount, cuisine, url, deliveryTime, distance, description) - never for its markup.
Rules:
- Use ONLY selectors that appear in the samples. Never invent one.
- Drop pure punctuation, separators and decoration ("·", "|", empty strings).
- Set attr:"href" for a link column, otherwise attr:null.
- required:true only for columns present and non-empty in EVERY sample - typically the name and url.
- toolName is a camelCase verb phrase for fetching this collection (listRestaurants, getMenu).`

/** The one place a model is needed: which string in a card is a name, and which is a price. */
export async function inferRowSchema(candidate, page, context) {
  const rows = candidate.fieldRows || await page.evaluate(({ container, rowSelector, leaves }) => {
    const root = document.querySelector(container)
    const kids = rowSelector ? [...root.querySelectorAll(rowSelector)] : [...root.children]
    return kids.slice(0, 3).map((row) =>
      leaves.map((l) => {
        const el = row.querySelector(l.selector)
        return { selector: l.selector, attr: l.attr, value: (l.attr ? el?.getAttribute(l.attr) : el?.textContent || '')?.trim().slice(0, 120) || '' }
      }).filter((x) => x.value),
    )
  }, { container: candidate.container, rowSelector: candidate.rowSelector, leaves: candidate.leaves })

  const fallback = () => {
    const link = candidate.leaves.find((f) => f.attr === 'href')
    const text = candidate.leaves.find((f) => !f.attr && f.sample.length > 1)
    const fields = [
      ...(text ? [{ name: 'name', selector: text.selector, attr: null, description: 'The primary visible label for this result.', required: true }] : []),
      ...(link ? [{ name: 'url', selector: link.selector, attr: 'href', description: 'The public URL for this result.', required: true }] : []),
    ]
    return {
      toolName: /restaurant/i.test(context.intent || context.title || '') ? 'listRestaurants' : 'listItems',
      description: 'Extract the visible results from this public page.', fields, by: 'deterministic/fallback',
    }
  }
  if (!config.keys.openai) return fallback()
  const client = new OpenAI({ apiKey: config.keys.openai, timeout: 40000 })
  let out
  try {
    const res = await client.chat.completions.create({
    model: MODEL, temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'row_schema', strict: true, schema: ROW_SCHEMA } },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ pageTitle: context.title, pageUrl: context.url, reachedBy: context.why, intent: context.intent || null, appVocabulary: context.vocabulary?.nouns || [], sampleRows: rows }) },
    ],
  })
    out = JSON.parse(res.choices[0].message.content)
  } catch {
    return fallback()
  }
  // The model is advisory about MEANING, never about what exists: a selector it
  // did not see in the samples is a hallucination, and a tool built on one
  // returns empty strings forever.
  const known = new Set(candidate.leaves.map((l) => `${l.selector}|${l.attr || ''}`))
  const used = new Set()
  out.fields = out.fields.filter((f) => {
    const key = `${f.selector}|${f.attr || ''}`
    if (!known.has(key) || used.has(key)) return false
    // Semantics are not trusted merely because a selector exists. A card badge
    // can be non-empty while being a rating, not a price; require its observed
    // samples to look like the meaning the schema assigns.
    const values = rows.flatMap((row) => row.filter((v) => `${v.selector}|${v.attr || ''}` === key).map((v) => v.value))
    const rule = /price|cost|fare/i.test(f.name) ? /(?:£|\$|€)\s?\d/
      : /calorie|kcal/i.test(f.name) ? /\b\d+\s*kcal\b/i
        : /rating/i.test(f.name) ? /^\d(?:\.\d+)?$/
          : null
    if (rule && !values.some((value) => rule.test(value))) return false
    used.add(key)
    return true
  })
  // A rendered currency value is factual structure, not a semantic guess. If
  // the model focuses on a product URL or title, preserve the first recurring
  // currency selector so price comparison remains possible on any catalogue.
  const money = candidate.leaves.find((f) => !f.attr && /(?:£|\$|€)\s?\d/.test(f.sample))
  if (!out.fields.some((f) => /price|cost|fare/i.test(f.name)) && money) {
    out.fields.push({ name: 'price', selector: money.selector, attr: null, description: 'The displayed price for this result.', required: false })
  }
  // Card markup is often inconsistent around badges, but a rendered currency
  // amount is an unambiguous value. Preserve it as a row-text derivation when
  // no stable element selector survived; this lets an agent compare prices
  // without pretending a "Popular" badge is monetary data.
  if (!out.fields.some((f) => /price|cost|fare/i.test(f.name)) && candidate.rows.some((row) => /(?:£|\$|€)\s?\d/.test(row))) {
    out.fields.push({ name: 'price', selector: null, attr: null, derive: 'currency', description: 'The first displayed currency amount for this item.', required: false })
  }
  return { ...out, by: `openai/${MODEL}` }
}

/** Turn a probe result plus its inferred schema into an emittable tool. */
export function toTool(inferred, candidate, recipe, samples, evidence) {
  const properties = {}
  for (const [k, v] of Object.entries(recipe.params)) properties[k] = { type: 'string', description: v }
  const rowProps = Object.fromEntries(inferred.fields.map((f) => [f.name, { type: 'string', description: f.description }]))
  return {
    // A model may correctly identify card fields yet invent a very specific
    // collection name from surrounding page chrome (e.g. footer terms on a
    // restaurant search). The route that produced the collection is a harder
    // fact: a submitted search is always `searchResults`.
    name: recipe.via === 'form' ? 'searchResults' : inferred.toolName,
    kind: 'read',
    description: `${inferred.description} Returns ${inferred.fields.map((f) => f.name).join(', ')} per row.`,
    destructive: false,
    inputSchema: { type: 'object', properties, required: Object.keys(properties) },
    rowSchema: { type: 'object', properties: rowProps, required: inferred.fields.filter((f) => f.required).map((f) => f.name) },
    recipe: { ...recipe, container: candidate.container, rowSelector: candidate.rowSelector, fields: inferred.fields.map(({ name, selector, attr, derive }) => ({ name, selector, attr, derive })) },
    samples,
    provenance: { evidence: { ...evidence, rowsSeen: candidate.n, why: candidate.why, sampleRows: candidate.rows.slice(0, 3) }, schemaBy: inferred.by, discoveredBy: 'read-probe' },
  }
}
