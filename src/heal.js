/**
 * heal.js - a tool that stopped working is re-derived, not hand-patched.
 *
 * The compiler already knows how to find this action: it found it once. Healing
 * re-runs that discovery at the tool's own seed, matches the result by the name
 * synthesis produces, and swaps in the fresh recipe. A renamed button still
 * yields createProject; a regenerated element id still yields a working chain.
 *
 * This is why the artifact is a compiler and not a scraper: the repair path is
 * the build path.
 */
import { discoverOn, discoverInline } from './discover.js'
import { synthesize } from './synthesize.js'

/**
 * @returns {{repaired:boolean, recipe?:object, note:string}}
 */
export async function heal(tool, session) {
  const { page } = session
  const seed = tool.recipe?.seedUrl
  if (!seed) return { repaired: false, note: 'no seed url recorded' }

  const found = []
  try {
    found.push(...(await discoverOn(page, seed, {})))
    found.push(...(await discoverInline(page, seed, {})))
  } catch (e) {
    return { repaired: false, note: `re-exploration failed: ${e.message.split('\n')[0]}` }
  }

  const candidates = synthesize(found)
  const match = candidates.find((c) => c.name === tool.name)
  if (!match) {
    return { repaired: false, note: `re-explored ${seed} and ${candidates.length} actions came back, none named ${tool.name}` }
  }

  const before = JSON.stringify(tool.recipe)
  const after = JSON.stringify(match.recipe)
  return {
    repaired: true,
    recipe: match.recipe,
    inputSchema: match.inputSchema,
    note: before === after ? 'recipe unchanged - failure was not the recipe' : `recipe updated (${describeDelta(tool.recipe, match.recipe)})`,
  }
}

function describeDelta(a, b) {
  const parts = []
  if (a.click !== b.click) parts.push(`click "${a.click}" -> "${b.click}"`)
  const as = (a.fields || []).map((f) => f.selector).join(),
        bs = (b.fields || []).map((f) => f.selector).join()
  if (as !== bs) parts.push('selectors re-resolved')
  return parts.join('; ') || 'no visible delta'
}
