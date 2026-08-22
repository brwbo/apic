/**
 * Capture the apic title hero as a deck-ready slide.
 *
 *   node scripts/slide.mjs [--url http://localhost:5177] [--scale 2] [--out slides/apic-title.png] [--t 1.6]
 *
 * Requires the UI dev server to be running (npm run dev --prefix ui).
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const url = arg('--url', 'http://localhost:5177')
const scale = Number(arg('--scale', '2'))
const out = arg('--out', 'slides/apic-title.png')
const t = arg('--t', '1.0') // backdrop video frame, in seconds

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 }, // 16:9
  deviceScaleFactor: scale,
})

await page.goto(`${url}${url.includes('?') ? '&' : '?'}still=1&t=${t}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

// Park the backdrop video on an exact frame so exports are reproducible.
await page.evaluate(async (time) => {
  const v = document.querySelector('video[data-hero-video]')
  if (!v) return
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }))
  v.pause()
  if (Math.abs(v.currentTime - time) > 0.01) {
    await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = time })
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}, Number(t))

await page.waitForTimeout(400)

await mkdir(dirname(out), { recursive: true })
await page.screenshot({ path: out })
await browser.close()

console.log(`${out} — ${1920 * scale}x${1080 * scale}`)
