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
    const out = []
    for (const el of document.querySelectorAll('input, textarea, select, [contenteditable="true"]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const type = el.getAttribute('type') || el.tagName.toLowerCase()
      if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue
      const id = el.id
      const labelEl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest('label')
      out.push({
        name: el.getAttribute('name') || id || '',
        label: (labelEl?.innerText || '').trim().slice(0, 40),
        placeholder: el.getAttribute('placeholder') || '',
        type: type === 'textarea' ? 'text' : type,
        required: el.hasAttribute('required'),
        selector: id ? `#${CSS.escape(id)}` : el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : null,
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
    try {
      await page.fill(f.selector, value, { timeout: 2000 })
      used.push({ ...f, value })
    } catch { /* not fillable - a select or a custom widget; skip */ }
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
