/**
 * synthesize.js - a discovered action becomes a typed tool.
 *
 * Two synthesisers behind one interface:
 *   heuristic - keyless. Verb+noun from the label, JSON Schema from the fields.
 *   model     - OpenAI, structured output. Better names, better descriptions,
 *               and it can infer preconditions the heuristic cannot see.
 */

const VERBS = [
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
  const noun = lower.replace(hit?.[0] || '', '').replace(/^(a|an|the)\s+/, '').trim() || 'item'
  return camel(`${verb} ${noun}`)
}

const JSON_TYPE = { number: 'number', email: 'string', date: 'string', checkbox: 'boolean' }

export function heuristicTool(action) {
  const properties = {}, required = []
  for (const p of action.parameters) {
    const key = camel(p.name || p.label || p.placeholder || 'value')
    properties[key] = {
      type: JSON_TYPE[p.type] || 'string',
      description: (p.label || p.placeholder || key).replace(/…|\.\.\.$/, '').trim(),
    }
    if (p.required) required.push(key)
    p.schemaKey = key
  }
  return {
    name: nameFor(action.label),
    description: action.evidence?.announced
      ? `${action.label}. Confirmed by the app: "${action.evidence.announced.text}"`
      : `${action.label} in the target app. Observed effect: ${action.effect}.`,
    inputSchema: { type: 'object', properties, required },
    // How the emitted server replays this action.
    recipe: {
      seedUrl: action.seedUrl,
      click: action.label,
      fields: action.parameters.map((p) => ({ selector: p.selector, schemaKey: p.schemaKey })),
      submit: true,
      expect: action.effect,
    },
    provenance: { evidence: action.evidence, discoveredBy: 'heuristic' },
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
    .filter((a) => (requireConfirmation ? Boolean(a.evidence?.announced) : a.effect !== 'navigation'))
    .map(heuristicTool)
    .filter((t) => (seen.has(t.name) ? false : seen.add(t.name)))
}
