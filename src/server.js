#!/usr/bin/env node
/**
 * server.js - apic as a live MCP server.
 *
 * One tool to start with: compile_app. Point it at a URL and it explores the
 * app, synthesises tools, emits them to generated/<app>/ - and then registers
 * every one of them on *this already-running server*, announcing them with
 * notifications/tools/list_changed. No restart, no second process.
 *
 * Both dead ends a caller can hit are answered here rather than reported:
 * asking for a tool that does not exist returns the compile_app call that would
 * create it, and calling a tool the app has since moved re-explores and repairs
 * it in place. The client's failure is the compiler's input.
 *
 * stdout is the JSON-RPC channel. Everything human goes to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile, ROOT } from './compile.js'
import { replay } from './replay.js'
import { heal } from './heal.js'
import { openSession, closeSession, ensure } from './session.js'
import { config } from './config.js'

// Overridable so a cold-start ("no tools until you compile one") can be
// demonstrated without moving the real output directory aside.
const GENERATED = process.env.APIC_GENERATED || join(ROOT, 'generated')
const log = (...m) => console.error('[apic]', ...m)

/** publicName -> { app, tool }. The single source of truth for tools/list. */
const registry = new Map()

const COMPILE_APP = {
  name: 'compile_app',
  description:
    'Compile a web app into MCP tools by exploring its UI. Runs the apic pipeline ' +
    '(explore -> distill -> synthesize -> emit), writes generated/<app>/, then registers ' +
    'the compiled tools on this server and emits notifications/tools/list_changed. ' +
    'The new tools are callable immediately, without restarting the client.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: `Base URL of the app to compile. Defaults to ${config.target.url}.` },
      goal: { type: 'string', description: 'What the tools are for. Any /path named here is added to the seed set.' },
    },
    required: [],
  },
}

/**
 * Register one app's compiled tools, replacing whatever that app registered
 * before - a recompile supersedes its own previous output rather than colliding
 * with it. Cross-app collisions are namespaced instead of silently overwritten.
 */
function registerApp(app, tools) {
  for (const [name, entry] of registry) if (entry.app === app) registry.delete(name)
  const taken = (n) => n === COMPILE_APP.name || registry.has(n)
  const names = []
  for (const tool of tools) {
    const name = taken(tool.name) ? `${app}_${tool.name}` : tool.name
    registry.set(name, { app, tool })
    names.push(name)
  }
  return names
}

/** Read generated/<app>/tools.json. Returns null if there is nothing usable there. */
function readGenerated(app) {
  const file = join(GENERATED, app, 'tools.json')
  if (!existsSync(file)) return null
  try {
    const { tools } = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(tools) && tools.length ? tools : null
  } catch (err) {
    log(`skipping ${app}: ${err.message}`)
    return null
  }
}

/** Pre-register everything already compiled, so a restart is never a cold start. */
function loadGenerated() {
  if (!existsSync(GENERATED)) return
  for (const app of readdirSync(GENERATED, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const tools = readGenerated(app)
    if (tools) log(`pre-registered ${registerApp(app, tools).length} tools from generated/${app}/`)
  }
}

// One browser and one login shared by every replay. Vikunja rate-limits login,
// so a server that authenticated per tool call would go red under demo load.
let shared = null
async function session() {
  if (shared?.browser?.isConnected()) return shared
  shared = await openSession({ headless: true })
  return shared
}

const server = new Server(
  { name: 'apic', version: '0.1.0' },
  { capabilities: { tools: { listChanged: true } } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
    COMPILE_APP,
    ...[...registry].map(([name, { tool }]) => ({
      name, description: tool.description, inputSchema: tool.inputSchema,
    })),
  ]
  // Logged deliberately: a tools/list arriving *after* the list_changed line
  // below is the proof that the client honoured the notification. See
  // docs/mcp-client.md.
  log(`tools/list -> ${tools.length} tools [${tools.map(t => t.name).join(', ')}]`)
  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params
  if (name === COMPILE_APP.name) return runCompile(args)

  const entry = registry.get(name)
  if (!entry) return unknownTool(name)
  return runTool(name, entry, args)
})

/**
 * The wall, and the way through it.
 *
 * A caller asking for a tool that does not exist has hit precisely the condition
 * apic exists for: the app has no API for that action *yet*. Answering with a
 * bare "unknown tool" ends the conversation at the exact moment the product
 * should start, so the escape hatch is named in the error itself - with the
 * arguments already filled in.
 */
function unknownTool(name) {
  const callable = [...registry.keys()]
  const apps = [...new Set([...registry.values()].map((e) => e.app))]
  const compiled = apps.length ? `compiled so far: ${apps.join(', ')}` : 'nothing is compiled yet'
  return {
    isError: true,
    content: [{ type: 'text', text: [
      `unknown tool: ${name}`,
      ``,
      `No compiled tool exposes that action (${compiled}). If the app has no API for it, make one:`,
      ``,
      `    compile_app { "url": "${config.target.url}", "goal": "${name}" }`,
      ``,
      `That explores the app's UI, synthesises typed tools, registers them on this running server`,
      `and announces them - so ${name} may exist a minute from now. Compile, then retry this call.`,
      callable.length ? `\nCallable right now: ${callable.join(', ')}` : ``,
    ].join('\n') }],
  }
}

/** A dead page takes every later call with it - revive rather than report drift. */
const DEAD = /browser has been closed|Target page, context or browser has been closed|Target closed/i

async function revive() {
  await closeSession(shared); shared = null
  return session()
}

/** replay(), with a thrown error flattened into the shape a failed result already has. */
async function attempt(tool, args, s) {
  try { return await replay(tool, args, { session: s }) }
  catch (err) { return { ok: false, error: err.message.split('\n')[0] } }
}

/** Write a healed recipe back to generated/<app>/tools.json, so a restart keeps the repair. */
function persistHeal(app, healed) {
  const file = join(GENERATED, app, 'tools.json')
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const i = (doc.tools || []).findIndex((t) => t.name === healed.name)
    if (i === -1) return false
    doc.tools[i] = healed
    writeFileSync(file, JSON.stringify(doc, null, 2))
    return true
  } catch (err) {
    log(`could not persist the heal for ${healed.name}: ${err.message}`)
    return false
  }
}

const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] })

/**
 * Call one compiled tool - and when it has stopped working, repair it here
 * rather than handing the caller a failure.
 *
 * This is the loop watch.js runs on a timer, triggered by demand instead. The
 * compiler found this action once, so it can find it again: a UI that moved
 * since the compile costs one re-exploration, not a dead tool. Healing on the
 * call path is what makes the interface durable for a client that only ever
 * shows up when it needs something.
 */
async function runTool(name, { app, tool }, args) {
  let s = await session()
  let res = await attempt(tool, args, s)

  if (!res.ok && DEAD.test(res.error || '')) { s = await revive(); res = await attempt(tool, args, s) }
  // Not being on /login is no proof of being logged in, but being on it is
  // proof of the opposite - and an expired session is not drift.
  if (!res.ok && s.page.url().includes('/login')) {
    await ensure(s).catch(() => {})
    res = await attempt(tool, args, s)
  }
  if (res.ok) return text(res)

  log(`${name} is red (${res.error || res.effect}) - re-exploring to heal it`)
  const t0 = Date.now()
  let fix = await heal(tool, s)
  if (!fix.repaired && DEAD.test(fix.note || '')) { s = await revive(); fix = await heal(tool, s) }

  if (!fix.repaired) {
    return { isError: true, content: [{ type: 'text', text:
      `${name} failed: ${res.error || res.effect || 'no effect observed'}\n` +
      `heal could not re-derive it: ${fix.note}\n\n` +
      `The action may have moved or gone. Recompile: compile_app { "url": "${tool.recipe?.seedUrl || config.target.url}" }` }] }
  }

  Object.assign(tool, {
    recipe: fix.recipe,
    inputSchema: fix.inputSchema || tool.inputSchema,
    // replay's opener() clicks by the control handles recorded in provenance
    // before it ever looks at recipe.click. Keeping the old ones would send the
    // retry back to the button the deploy just renamed.
    provenance: fix.provenance || tool.provenance,
    healedAt: new Date().toISOString(),
  })
  const persisted = persistHeal(app, tool)
  // A healed tool can take different parameters than the one the client listed.
  try { await server.sendToolListChanged() } catch { /* the client may not support it */ }

  const after = await attempt(tool, args, s)
  const ms = Date.now() - t0
  log(`${name} healed in ${(ms / 1000).toFixed(1)}s (${fix.note}); retry ${after.ok ? 'passed' : 'failed'}`)

  if (!after.ok) {
    return { isError: true, content: [{ type: 'text', text:
      `${name} broke, was healed (${fix.note}), and still does not work: ${after.error || after.effect}` }] }
  }
  return text({ ...after, healed: { note: fix.note, ms, persisted } })
}

async function runCompile({ url = config.target.url, goal = '' }) {
  if (!/^https?:\/\//.test(String(url))) throw new Error(`compile_app needs an http(s) url, got: ${url}`)

  const result = await compile({ url, goal, outDir: GENERATED, onLog: (l) => log(l) })
  const names = registerApp(result.app, result.tools)

  // The linchpin: tell the client its tool list just changed. If the client
  // honours this, the tools below are callable in this same session.
  let announced = 'sent'
  try { await server.sendToolListChanged() } catch (err) { announced = `failed: ${err.message}` }
  log(`registered ${names.length} tools as [${names.join(', ')}]; list_changed ${announced}`)

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        app: result.app,
        url,
        goal,
        emittedTo: result.dir,
        registered: names,
        listChangedNotification: announced,
        note: 'These tools are registered on this running server. Call tools/list to see them.',
        tools: result.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: Object.keys(t.inputSchema.properties),
        })),
      }, null, 2),
    }],
  }
}

loadGenerated()
process.on('exit', () => { shared?.browser?.close().catch(() => {}) })
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await closeSession(shared); process.exit(0) })
}

await server.connect(new StdioServerTransport())
log(`ready - ${registry.size} compiled tools + compile_app`)
