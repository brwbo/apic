#!/usr/bin/env node
/**
 * Replays the public bundles used in the recording. These are regression
 * fixtures for different site shapes, not routes embedded in APIC's compiler.
 * A red result means do not record.
 */
import { readFileSync } from 'node:fs'
import { replayRead } from '../src/replay-read.js'

const fixture = [
  {
    app: 'govuk-services', label: 'GOV.UK', search: 'searchResults',
    args: { query: 'first provisional driving licence' }, detail: 'listSteps',
    choose: (rows) => rows.find((row) => /first provisional/i.test(row.name || ''))?.url,
    fields: ['stepTitle'],
  },
  {
    app: 'deliveroo', label: 'Deliveroo', search: 'searchResults',
    args: { query: process.env.APIC_DEMO_POSTCODE || 'EC2A 3AY' }, detail: 'listMenuItems',
    choose: (rows) => rows.find((row) => /pizza/i.test(row.name || ''))?.url || rows[0]?.url,
    fields: ['name', 'price'],
  },
  {
    app: 'airbnb', label: 'Airbnb', search: 'searchResults',
    args: { query: 'London', checkIn: '2026-09-10', checkOut: '2026-09-12', guests: '1' },
    fields: ['name', 'url', 'price'],
  },
  {
    app: 'amazon', label: 'Amazon', search: 'searchResults',
    args: { query: 'lynx africa deodorant' },
    fields: ['name', 'url', 'price'],
  },
]

function bundle(app) {
  return JSON.parse(readFileSync(new URL(`../generated/${app}/tools.json`, import.meta.url), 'utf8')).tools
}

function tool(tools, name) {
  const found = tools.find((candidate) => candidate.name === name && candidate.verification?.verified)
  if (!found) throw new Error(`missing cold-verified ${name}`)
  return found
}

async function check(one) {
  const tools = bundle(one.app)
  const listing = tool(tools, one.search)
  const listed = await replayRead(listing, one.args)
  if (!listed.ok) throw new Error(`search failed: ${listed.error}`)
  if (!one.detail) {
    const usable = listed.rows.filter((row) => one.fields.every((field) => String(row[field] || '').trim()))
    if (!usable.length) throw new Error(`search returned no rows with ${one.fields.join(', ')}`)
    return { listingRows: listed.count, detailRows: usable.length }
  }
  const url = one.choose(listed.rows)
  if (!url) throw new Error('search returned no public detail URL')
  const detail = tool(tools, one.detail)
  const read = await replayRead(detail, { url })
  if (!read.ok) throw new Error(`detail failed: ${read.error}`)
  const usable = read.rows.filter((row) => one.fields.every((field) => String(row[field] || '').trim()))
  if (!usable.length) throw new Error(`detail returned no rows with ${one.fields.join(', ')}`)
  return { listingRows: listed.count, detailRows: usable.length, url }
}

let failed = false
for (const one of fixture) {
  try {
    const result = await check(one)
    console.log(`PASS ${one.label}: ${result.listingRows} listings -> ${result.detailRows} usable detail rows`)
  } catch (error) {
    failed = true
    console.error(`FAIL ${one.label}: ${error.message}`)
  }
}
if (failed) process.exitCode = 1
