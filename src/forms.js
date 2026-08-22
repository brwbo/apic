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
      // <label for> is the modern way. Table-layout forms - which is most
      // software written before 2010, and therefore most software with no API -
      // put the label in the preceding cell or an adjacent node instead.
      let labelEl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null
      if (!labelEl) labelEl = el.closest('label')
      let labelText = (labelEl?.innerText || '').trim()
      if (!labelText) {
        const cell = el.closest('td, th, .form-group, .field, p, div')
        const prev = cell?.previousElementSibling
        const near = (prev?.innerText || '').trim()
        // a neighbouring cell is only a label if it is short and not a control
        if (near && near.length < 40 && !prev?.querySelector('input, select, textarea')) labelText = near
      }
      const attr = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      // Ordered locator chain, most durable first. A recorded selector outlives
      // the UI only if it means something: `[name="projectTitle"]` survives a
      // re-render, `#v-3` is a counter over Vue's component order and does not.
      const selectors = []
      if (name) selectors.push(`[name="${attr(name)}"]`)
      if (id && !AUTO_ID.test(id)) selectors.push(`#${CSS.escape(id)}`)
      if (placeholder) selectors.push(`[placeholder="${attr(placeholder)}"]`)
      if (aria) selectors.push(`${el.tagName.toLowerCase()}[aria-label="${attr(aria)}"]`)
      // A stable prefix with a regenerated tail - `task-add-textarea-rywuedqiv`
      // is a different id on every render, so record what survives.
      const tail = /^(.+[-_])[A-Za-z0-9]{4,}$/.exec(id || '')
      if (tail) selectors.push(`[id^="${attr(tail[1])}"]`)
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
    let hit = null, chosen = value
    for (const sel of f.selectors?.length ? f.selectors : [f.selector]) {
      if (!sel) continue
      try {
        if (f.type === 'select') {
          // page.fill() throws on a <select>. ParaBank's open-account form is
          // nothing but dropdowns, and a compiler that cannot pick an option
          // cannot compile most enterprise forms.
          chosen = await page.$eval(sel, (el) => {
            const opts = [...el.options].filter((o) => o.value !== '' && !/^-+|choose|select/i.test(o.text))
            return (opts[0] || el.options[0])?.value ?? ''
          })
          await page.selectOption(sel, chosen, { timeout: 1500 })
        } else {
          await page.fill(sel, value, { timeout: 1500 })
        }
        hit = sel
        break
      } catch { /* try the next */ }
    }
    if (hit) used.push({ ...f, value: chosen, selector: hit })
    // no hit: not fillable - a custom widget; skip
  }
  return used
}

/**
 * The control that commits the form.
 *
 * Modern apps use <button>Save</button>. Legacy apps - the ones with no API and
 * therefore the whole point of this project - use <input type="submit"
 * value="Save">, where the label lives in an attribute and innerText is empty.
 * Reading only innerText makes every 2005-era app look like it has no buttons.
 */
export async function submitButton(page) {
  const handles = await page.$$('button:visible, [role="button"]:visible, input[type="submit"]:visible, input[type="button"]:visible')
  for (const h of handles) {
    const label = await h.evaluate((el) => (el.value || el.innerText || '').trim())
    if (label && SUBMIT.test(label)) return { handle: h, label }
  }
  // A lone submit input with an app-specific label ("Open New Account") is
  // still the commit control even though it matches no generic verb.
  const lone = await page.$$('input[type="submit"]:visible, input[type="button"]:visible')
  if (lone.length === 1) {
    const label = await lone[0].evaluate((el) => (el.value || '').trim())
    return { handle: lone[0], label: label || 'submit' }
  }
  return null
}

/**
 * The control that confirms a destructive action inside a modal.
 * Kept separate from submitButton: a confirm is not a commit, and conflating
 * them makes a delete dialog look like a form.
 */
const CONFIRM = /^(do it|yes|confirm|delete|remove|ok)\b/i

export async function confirmButton(page) {
  const buttons = await page.$$('.modal button:visible, .modal-content button:visible, [role="dialog"] button:visible, .modal input[type="button"]:visible, [role="dialog"] input[type="button"]:visible')
  for (const b of buttons) {
    const t = await b.evaluate((el) => (el.value || el.innerText || '').trim())
    if (t && CONFIRM.test(t)) return { handle: b, label: t }
  }
  return null
}
