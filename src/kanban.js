/**
 * kanban.js - drag actions.
 *
 * Moving a card between columns is the most legible action on a board and the
 * one a button-first explorer can never find: there is no button. It also needs
 * a third confirmation signal - the card did not appear or disappear, it
 * RELOCATED, which node counting reads as "no change".
 */

/** Columns are sibling containers that each hold draggable children. */
export async function columns(page) {
  return page.evaluate(() => {
    const CARD = '.task, [class*="card"], [draggable="true"]'
    // Common column vocabulary across board apps. Checked first because it is
    // cheap and right; the sibling heuristic below is the general fallback.
    for (const hint of ['.bucket', '.column', '.lane', '[class*="column"]', '[class*="bucket"]', '[class*="lane"]']) {
      const els = [...document.querySelectorAll(hint)].filter((e) => !e.matches(CARD) && !e.closest(CARD))
      if (els.length >= 2 && els.some((e) => e.querySelector(CARD))) {
        return { selector: hint, count: els.length, via: 'vocabulary' }
      }
    }
    // Fallback: sibling containers that hold cards but are not cards themselves.
    const groups = new Map()
    for (const el of document.querySelectorAll('div, section, ul')) {
      if (el.matches(CARD) || el.closest(CARD)) continue
      if (!el.querySelector(CARD)) continue
      const key = typeof el.className === 'string' ? el.className.trim() : ''
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(el)
    }
    let best = null
    for (const [key, els] of groups) {
      if (els.length < 2) continue
      const held = new Set(els.flatMap((e) => [...e.querySelectorAll(CARD)]))
      if (held.size < 1) continue
      if (!best || els.length > best.count) best = { selector: '.' + key.split(/\s+/).join('.'), count: els.length, via: 'heuristic' }
    }
    return best
  })
}

/** Column titles and the cards inside each - the containment map. */
export async function board(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((b) => ({
    title: (b.querySelector('.bucket-header, h2, h3, .title')?.innerText || '').trim().slice(0, 24),
    cards: [...b.querySelectorAll('.task, [class*="card"]')].map((t) => (t.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)),
  })), selector)
}

/** Relocation: a card left one column and arrived in another. */
export function relocated(before, after) {
  for (let i = 0; i < before.length; i++) {
    const gone = before[i].cards.filter((c) => !after[i]?.cards.includes(c))
    if (!gone.length) continue
    for (let j = 0; j < after.length; j++) {
      if (i === j) continue
      const arrived = after[j].cards.filter((c) => !before[j]?.cards.includes(c))
      const match = gone.find((g) => arrived.includes(g))
      if (match) return { card: match, from: before[i].title, to: after[j].title }
    }
  }
  return null
}

/** Human-like drag. HTML5 dragTo does not work with JS drag libraries. */
export async function drag(page, cardLocator, targetLocator, { steps = 12 } = {}) {
  const cb = await cardLocator.boundingBox()
  const tb = await targetLocator.boundingBox()
  if (!cb || !tb) return false
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await page.mouse.down()
  const dx = tb.x + tb.width / 2 - (cb.x + cb.width / 2)
  const dy = tb.y + 80 - (cb.y + cb.height / 2)
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cb.x + cb.width / 2 + dx * (i / steps), cb.y + cb.height / 2 + dy * (i / steps))
    await page.waitForTimeout(55)
  }
  await page.mouse.up()
  await page.waitForTimeout(1800)
  return true
}

/** Discover the move action on a board view. */
export async function discoverMove(page, seedUrl) {
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)

  const col = await columns(page)
  if (!col || col.count < 2) return null

  const before = await board(page, col.selector)
  const fromIdx = before.findIndex((b) => b.cards.length)
  const toIdx = before.findIndex((b, i) => i !== fromIdx)
  if (fromIdx < 0 || toIdx < 0) return null

  const card = page.locator(col.selector).nth(fromIdx).locator('.task, [class*="card"]').first()
  if (!(await drag(page, card, page.locator(col.selector).nth(toIdx)))) return null

  const after = await board(page, col.selector)
  const moved = relocated(before, after)
  if (!moved) return null

  return {
    label: 'Move card between columns',
    parameters: [
      { name: 'card', label: 'Card', type: 'text', required: true, example: moved.card, selector: col.selector },
      { name: 'column', label: 'Target column', type: 'text', required: true, example: moved.to, selector: col.selector },
    ],
    effect: 'relocation',
    changed: true,
    committed: true,
    drag: { columnSelector: col.selector, cardSelector: '.task, [class*="card"]' },
    evidence: { announced: { text: `"${moved.card}" moved from ${moved.from} to ${moved.to}`, kind: 'relocation' }, added: [], removed: [], from: seedUrl, to: seedUrl },
    seedUrl,
  }
}
