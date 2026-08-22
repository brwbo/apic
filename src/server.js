#!/usr/bin/env node
/**
 * server.js - apic as a live MCP server.
 *
 * One tool to start with: compile_app. Point it at a URL and it explores the
 * app, synthesises tools, emits them to generated/<app>/ - and then registers
 * every one of them on *this already-running server*, announcing them with
 * notifications/tools/list_changed. No restart, no second process.
 *
 * stdout is the JSON-RPC channel. Everything human goes to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile, ROOT } from './compile.js'
import { replay } from './replay.js'
import { openSession, closeSession } from './session.js'
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
  if (!entry) throw new Error(`unknown tool: ${name}`)
  try {
    const result = await replay(entry.tool, args, { session: await session() })
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    // A dead browser should cost one call, not every call after it.
    await closeSession(shared); shared = null
    return { isError: true, content: [{ type: 'text', text: `${name} failed: ${err.message}` }] }
  }
})

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
