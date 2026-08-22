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
    // A generated id like task-add-textarea-ruqx7h8qv is not a parameter name.
    // Prefer what a human reads: the label, then the placeholder.
    const AUTO = /[-_][a-z0-9]{7,}$/i
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
      click: action.label,
      fields: action.parameters.map((p) => ({ selector: p.selector, schemaKey: p.schemaKey })),
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
