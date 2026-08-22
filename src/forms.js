/**
 * forms.js - find and fill whatever form an action opened.
 *
 * Field discovery is the part that turns "clicked a button" into a typed tool:
 * each field becomes a parameter in the emitted schema.
 */
import { fieldValue } from './plan.js'

const SUBMIT = /^(create|save|add|submit|done|confirm|ok)\b/i

/** Visible, editable fields on the page - these become tool parameters. */
export async function fields(page) {
  return page.evaluate(() => {
    // Framework-generated ids (Vue useId, React useId, Headless UI, Radix, MUI)
    // are stable only for a given component render order - they shift whenever
    // the component tree changes. Never trust one as the primary handle.
    const AUTO_ID = /^(v-\d+$|:r[0-9a-z]+:|headlessui-|radix-|mui-)/i
    const out = []
    for (const el of document.querySelectorAll('input, textarea, select, [contenteditable="true"]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const editable = el.getAttribute('contenteditable') === 'true'
      // A contenteditable is a <h1>/<div>, so tagName is not a field type.
      const type = editable ? 'text' : (el.getAttribute('type') || el.tagName.toLowerCase())
      if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue
      const id = el.id
      const name = el.getAttribute('name') || ''
      const placeholder = el.getAttribute('placeholder') || ''
      // The one handle a rich-text field reliably has. Vikunja's task title is
      // `<h1 contenteditable aria-label="Title">` - no id, no name, no
      // placeholder - so without this the rename gesture has no field at all
      // and rename is undiscoverable.
      const aria = el.getAttribute('aria-label') || ''
      const labelEl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest('label')
      const attr = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      // Ordered locator chain, most durable first. A recorded selector outlives
      // the UI only if it means something: `[name="projectTitle"]` survives a
      // re-render, `#v-3` is a counter over Vue's component order and does not.
      const selectors = []
      if (name) selectors.push(`[name="${attr(name)}"]`)
      if (id && !AUTO_ID.test(id)) selectors.push(`#${CSS.escape(id)}`)
      if (placeholder) selectors.push(`[placeholder="${attr(placeholder)}"]`)
      if (aria) selectors.push(`${el.tagName.toLowerCase()}[aria-label="${attr(aria)}"]`)
      if (id && AUTO_ID.test(id)) selectors.push(`#${CSS.escape(id)}`) // last resort

      out.push({
        name: name || id || '',
        label: (labelEl?.innerText || aria || '').trim().slice(0, 40),
        placeholder: placeholder || aria,
        type: type === 'textarea' ? 'text' : type,
        required: el.hasAttribute('required'),
        editable,
        selector: selectors[0] || null,
        selectors,
      })
    }
    return out.filter((f) => f.selector)
  })
}

/** Fill every discovered field with a plausible value. Returns what was used. */
export async function fill(page, discovered) {
  const used = []
  for (const f of discovered) {
    const value = fieldValue(f)
    // Record the locator that actually worked, not the one we guessed first.
    let hit = null
    for (const sel of f.selectors?.length ? f.selectors : [f.selector]) {
      if (!sel) continue
      try { await page.fill(sel, value, { timeout: 1500 }); hit = sel; break } catch { /* try the next */ }
    }
    if (hit) used.push({ ...f, value, selector: hit })
    // no hit: not fillable - a select or a custom widget; skip
  }
  return used
}

/** The button that commits the form. */
export async function submitButton(page) {
  const buttons = await page.$$('button:visible, [role="button"]:visible')
  for (const b of buttons) {
    const t = ((await b.innerText()) || '').trim()
    if (SUBMIT.test(t)) return { handle: b, label: t }
  }
  return null
}
