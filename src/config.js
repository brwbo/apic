import 'dotenv/config'

const REQUIRED_BY_STAGE = {
  explore:    ['HAI_API_KEY'],
  perceive:   ['FAL_KEY'],
  synthesize: ['OPENAI_API_KEY'],
  verify:     ['OPENAI_API_KEY'],
  ground:     ['TAVILY_API_KEY'],
  distill:    ['PIONEER_API_KEY'],
}

export const config = {
  target: {
    url:  process.env.TARGET_URL  || 'http://localhost:3456',
    user: process.env.TARGET_USER || 'apic',
    pass: process.env.TARGET_PASS || 'apicdemo2026',
  },
  keys: {
    openai:  process.env.OPENAI_API_KEY,
    fal:     process.env.FAL_KEY,
    tavily:  process.env.TAVILY_API_KEY,
    h:       process.env.HAI_API_KEY,
    pioneer: process.env.PIONEER_API_KEY,
  },
}

/** Which stages can run with the keys currently present. */
export function availableStages() {
  return Object.entries(REQUIRED_BY_STAGE).map(([stage, needs]) => ({
    stage,
    ready: needs.every((k) => Boolean(process.env[k])),
    needs,
  }))
}

/** Throw at the boundary rather than deep inside a provider call. */
export function requireStage(stage) {
  const needs = REQUIRED_BY_STAGE[stage]
  if (!needs) throw new Error(`unknown stage: ${stage}`)
  const missing = needs.filter((k) => !process.env[k])
  if (missing.length) throw new Error(`stage "${stage}" needs ${missing.join(', ')} - add to .env`)
}
