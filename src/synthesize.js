/**
 * synthesize.js - a discovered action becomes a typed tool.
 *
 * Two synthesisers behind one interface:
 *   heuristic - keyless. Verb+noun from the label, JSON Schema from the fields.
 *   model     - OpenAI, structured output. Better names, better descriptions,
 *               and it can infer preconditions the heuristic cannot see.
 *
 * Either way the action arriving here has already been through distill.js, so
 * `action.effect` may be an SLM classification rather than a node count, and
 * `action.destructive` decides whether the emitted tool demands a confirm.
 */

const VERBS = [
  [/^move\b/i, 'move'],
  [/^(new|add|create)\b|^\+$/i, 'create'],
  [/^(edit|rename|update|change)\b/i, 'update'],
  [/^(delete|remove|trash)\b/i, 'delete'],
  [/^(move|drag)\b/i, 'move'],
  [/^(assign)\b/i, 'assign'],
  [/^(mark|toggle|complete|done)\b/i, 'mark'],
]

const camel = (s) => {
  const cleaned = s.replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  // already camelCase or a single identifier - keep the author's casing
  if (/^[a-z][a-zA-Z0-9]*$/.test(cleaned)) return cleaned
  return cleaned.split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')
}

function nameFor(label) {
  const lower = label.toLowerCase().trim()
  const hit = VERBS.find(([re]) => re.test(lower))
  const verb = hit ? hit[1] : 'do'
  const noun = lower.replace(hit?.[0] || '', '').replace(/\b(a|an|the)\b/g, ' ').trim() || 'item'
  return camel(`${verb} ${noun}`)
}

const JSON_TYPE = { number: 'number', email: 'string', date: 'string', checkbox: 'boolean' }

/** A generated id like task-add-textarea-ruqx7h8qv: unique per page load. */
const AUTO = /[-_][a-z0-9]{7,}$/i

/**
 * The locators replay should try for one field, in order.
 *
 * #task-add-textarea-tfrx4opvy is a different element on the next page load, so
 * a recipe pinned to it can never replay. replay.js already falls back to
 * name/placeholder/label - it just has to be handed them.
 */
const fieldRecipe = (p) => ({
  selector: p.selector,
  ...(p.name && !AUTO.test(p.name) ? { name: p.name } : {}),
  ...(p.placeholder ? { placeholder: p.placeholder } : {}),
  ...(p.label ? { label: p.label } : {}),
})

/** Path part of a URL, whether it arrived absolute or relative. */
const pathOf = (u) => { try { return new URL(u, 'http://x').pathname } catch { return String(u || '') } }

/** A URL ending in a numeric id: one row, not a collection. */
const INSTANCE = /\/\d+$/

/**
 * Where replay can find another instance of the resource a tool acts on.
 *
 * The five task tools were all discovered on /tasks/308 - a task the explorer
 * created itself, and which deleteTask then deleted. Pinning a tool to the row
 * it was born on makes it a recording, not a tool: every replay after the first
 * lands on a 404.
 *
 * Nothing extra has to be observed to fix it. The action that created that row
 * already recorded the link to it (`created`) and the page it was created from
 * (`seedUrl`) - so that page lists this resource, and replay can ask it for a
 * row that exists now. Collection-seeded tools get nothing and keep their URL.
 */
function seedResolver(actions) {
  const creators = new Map()
  for (const a of actions) if (a.created) creators.set(pathOf(a.created), a)
  return (action) => {
    const here = pathOf(action.seedUrl)
    const creator = creators.get(here)
    if (!creator || !INSTANCE.test(here)) return undefined
    return {
      from: pathOf(creator.seedUrl),
      pattern: `^${here.replace(/\/\d+$/, '/\\d+')}$`,
      // And if the listing is empty, make one. deleteTask removes exactly the
      // row its four siblings were compiled against, so "no rows left" is the
      // normal state, not an edge case. The compiler already learned how to
      // create this resource - that recipe is the precondition for using it.
      create: {
        click: creator.control || creator.label,
        fields: creator.parameters.map(fieldRecipe),
      },
    }
  }
}

/**
 * An inline control is one where the thing clicked and the thing filled are the
 * same element - a contenteditable heading, a quick-add box already on the page.
 * There is no opener to click, and clicking anything that merely shares its name
 * ("Title" is also a nav link) navigates off the resource being edited.
 *
 * Recorded from what discovery already saw: the control's own name matching a
 * field's name is exactly what "the control is the field" looks like.
 */
const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function isInline(action) {
  const control = plain(action.control)
  if (!control) return false
  return action.parameters.some((p) => [p.label, p.placeholder].some((n) => n && plain(n) === control))
}

/** Say how we know this works, in the terms the evidence actually supports. */
function describeTool(action) {
  const a = action.evidence?.announced
  if (!a) return `${action.label} in the target app. Observed effect: ${action.effect}.`
  const isBanner = /success|created|saved|added|updated|deleted/i.test(a.text) && !/apic probe/i.test(a.text)
  return isBanner
    ? `${action.label}. Confirmed by the app: "${a.text.replace(/\s+/g, ' ').trim()}"`
    : `${action.label}. Confirmed: the submitted value appeared in the app after the action.`
}

export function heuristicTool(action) {
  const properties = {}, required = []
  for (const p of action.parameters) {
    // Prefer what a human reads: the label, then the placeholder.
    const raw = p.name && !AUTO.test(p.name) ? p.name : (p.label || p.placeholder || p.name || 'value')
    const key = camel(raw.replace(/^(add|enter|type)\s+(a|an|the)?\s*/i, '').replace(/…|\.\.\.$/, '').trim() || 'value')
    properties[key] = {
      type: JSON_TYPE[p.type] || 'string',
      description: (p.label || p.placeholder || key).replace(/…|\.\.\.$/, '').trim(),
    }
    if (p.required) required.push(key)
    p.schemaKey = key
  }
  // A destructive tool takes an explicit confirm. The classifier decides which
  // tools those are; without it every tool is treated as safe, which is the
  // wrong default for a generated API that drives a real app.
  if (action.destructive) {
    properties.confirm = { type: 'boolean', description: 'Must be true. This action destroys state and cannot be undone.' }
    required.push('confirm')
  }

  return {
    name: nameFor(action.label),
    description: describeTool(action),
    destructive: Boolean(action.destructive),
    inputSchema: { type: 'object', properties, required },
    // How the emitted server replays this action.
    recipe: action.drag ? {
      seedUrl: action.seedUrl,
      drag: action.drag,
      expect: 'relocation',
    } : {
      seedUrl: action.seedUrl,
      ...(action.seed ? { seed: action.seed } : {}),
      ...(isInline(action) ? { inline: true } : {}),
      click: action.label,
      fields: action.parameters.map((p) => ({ ...fieldRecipe(p), schemaKey: p.schemaKey })),
      submit: true,
      expect: action.effect,
    },
    provenance: { evidence: action.evidence, perception: action.perception, discoveredBy: action.perception?.source === 'pioneer' ? 'pioneer/gliner2' : 'heuristic' },
  }
}

/**
 * A tool exists only if the app itself confirmed the write.
 *
 * Node-counting produces plausible-looking tools for every button on the page.
 * An announcement region saying "successfully created" is the app asserting
 * that state changed, and it is the difference between a compiler and a
 * confident guesser. Recall suffers; precision is what makes this trustworthy.
 */
export function synthesize(actions, { requireConfirmation = true } = {}) {
  const seen = new Set()
  const seedFor = seedResolver(actions)
  for (const a of actions) a.seed = seedFor(a)
  return actions
    .filter((a) => a.committed)
    // persist.js reloaded the page and could not find what we submitted, so the
    // app displayed our input rather than storing it. null means it could not
    // be established either way, and that is not grounds to reject.
    .filter((a) => a.persisted !== false)
    .filter((a) => !/apic probe/i.test(a.label))
    .filter((a) => (requireConfirmation ? Boolean(a.evidence?.announced) : a.effect !== 'navigation'))
    .map(heuristicTool)
    .filter((t) => (seen.has(t.name) ? false : seen.add(t.name)))
}
