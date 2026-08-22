# Running apic as an MCP server

`npm run serve` starts `src/server.js`: an MCP server over stdio that exposes one
tool to begin with, `compile_app`. Point it at a URL and it runs the whole apic
pipeline in-process, emits `generated/<app>/`, **registers the compiled tools on
itself**, and sends `notifications/tools/list_changed`.

That last step is the interesting one. A compiler that needs you to restart the
thing it just extended is a build step. One that doesn't is a live compiler.

## Register it

```bash
claude mcp add apic -- node /Users/brwbo/Projects/apic/src/server.js
```

**Pass the env explicitly** if the client's working directory is not the repo.
`config.js` loads `.env` relative to the process CWD, so a server started from
elsewhere silently runs with no API keys — it still works (the Playwright driver
and DOM differ need no keys at all, fallback rung 3), but every model-backed
stage degrades to a heuristic:

```bash
claude mcp add apic -- node --env-file=/Users/brwbo/Projects/apic/.env /Users/brwbo/Projects/apic/src/server.js
```

`APIC_GENERATED=<dir>` overrides where compiled apps are read from and written to.
Handy for demoing a cold start without moving the real output directory aside.

## Does `list_changed` actually work?

**At the protocol level: yes, verified.** A stock `@modelcontextprotocol/sdk`
client, connected once and never reconnected, sees the tools appear and can call
them on the same connection. Full transcript from a cold start
(`APIC_GENERATED` pointed at an empty directory):

```
[apic] ready - 0 compiled tools + compile_app
[apic] tools/list -> 1 tools [compile_app]
BEFORE compile, tools/list = [ 'compile_app' ]
[apic] registered 3 tools as [createProject, createLabel, createTask]; list_changed sent
  <<< notifications/tools/list_changed received at 2026-08-22T10:55:59.130Z
[apic] tools/list -> 4 tools [compile_app, createProject, createLabel, createTask]
list_changed notification: YES
```

and a tool compiled seconds earlier, called over that same connection:

```
createLabel -> {"ok":true,"effect":"creation","expected":"creation","unfilled":[]}
```

The server declares `capabilities.tools.listChanged = true`, so the notification
is legal to send; the SDK asserts this and would throw otherwise.

**Whether a given client honours it is the client's call.** The server logs every
`tools/list` it receives, precisely so you can tell. Read the log top to bottom:
a `tools/list` line *after* the `list_changed sent` line means the client
refreshed itself. No such line means it did not.

### Testing it against Claude Code specifically

This has **not** been confirmed on this machine — headless `claude -p` could not
authenticate ("OAuth session expired and could not be refreshed"), so the
end-to-end run was never made. It takes about three minutes to do by hand:

1. `claude mcp add apic -- node /Users/brwbo/Projects/apic/src/server.js`
2. Open a Claude Code session **in this repo** and ask it to call `compile_app`
   with `url: http://localhost:3456`.
3. When it returns, ask it to call `createLabel` **without restarting anything.**
4. Read the server's log:

```bash
cat "$(ls -t ~/Library/Caches/claude-cli-nodejs/-Users-brwbo-Projects-apic/mcp-logs-apic/*.jsonl | head -1)"
```

Claude Code writes the server's stderr into that file. If a
`tools/list -> N tools` line appears after `list_changed sent`, it honoured the
notification. If `createLabel` succeeds in the same session, the answer is
unambiguous.

One data point, from Claude Code's own connection log: it records a server's
capabilities as `{"hasTools":true,"hasPrompts":false,"hasResources":false,
"hasResourceSubscribe":false}` — no field for `listChanged`. That is suggestive,
not conclusive, and it is why the fallback below exists.

## Fallback: restart the client

**Verified working.** Nothing is lost if a client ignores the notification. Every
compile writes `generated/<app>/tools.json` to disk, and the server pre-registers
everything it finds there on startup. So the worst case is one restart:

```
[apic] pre-registered 3 tools from generated/vikunja/
[apic] ready - 3 compiled tools + compile_app
[apic] tools/list -> 4 tools [compile_app, createProject, createLabel, createTask]
fresh process, no compile, tools/list = [ 'compile_app', 'createProject', 'createLabel', 'createTask' ]
```

That is a brand-new server process, started from `/tmp`, running no compile of
its own, serving tools a previous process compiled. In Claude Code:

```bash
claude mcp remove apic -s local && claude mcp add apic -- node /Users/brwbo/Projects/apic/src/server.js
```

or just start a new session. The compiled tools are files on disk, not session
state — the restart is a reconnect, never a recompile.

## The two dead ends, and what the server does with them

A client only meets apic at the moment something is missing. Both of those
moments are answered on the call path rather than reported.

**A tool that does not exist.** `tools/call` for an unregistered name does not
come back as a bare `unknown tool`. It comes back as the compile that would
create it, arguments already filled in:

```
--- WALL 1: a tool that does not exist ---
isError: true
unknown tool: createIssue

No compiled tool exposes that action (compiled so far: vikunja). If the app has no API for it, make one:

    compile_app { "url": "http://localhost:3456", "goal": "createIssue" }

That explores the app's UI, synthesises typed tools, registers them on this running server
and announces them - so createIssue may exist a minute from now. Compile, then retry this call.

Callable right now: createLabel
```

**A tool the app has moved out from under.** `watch.js` heals on a timer; the
server heals on demand, through the same `heal()`. The tool goes red, the
compiler re-explores that one action, the repair is written back to
`generated/<app>/tools.json`, and the call is retried before the caller ever
sees a failure. Verified against a recipe whose recorded handles had all been
invalidated - a deploy renaming the control:

```
[apic] createLabel is red (no control on http://localhost:3456/labels matched what this
       tool opens with: "ADD LABEL (RENAMED)" or "create label RENAMED-BY-A-DEPLOY")
       - re-exploring to heal it
[apic] createLabel healed in 13.6s (recipe updated (click "..." -> "create label";
       selectors re-resolved)); retry passed

returned in 28.9s, isError: false
{ "ok": true, "effect": "creation", "healed": { "ms": 13589, "persisted": true } }
```

A healthy tool is untouched by any of this: same call, 4.4s, no re-exploration.

> **Break every recorded handle, not just one.** `replay()`'s `opener()` tries
> every control handle in `provenance.evidence.controls` *before* `recipe.click`,
> and `fillField()` falls through selector, placeholder and label. Staling one of
> them is not drift - replay absorbs it and the tool never goes red. This is also
> why `heal()` returns fresh `provenance` alongside the recipe: a repair that
> left the old handles in place sent every retry back to the button the deploy
> had renamed, so the tool healed on every call and went green on none.

## Behaviour worth knowing

- **stdout is the JSON-RPC channel.** Every human-readable line goes to stderr.
  A stray `console.log` in any module the server imports will corrupt the
  protocol stream.
- **One browser, one login, shared across replays.** Vikunja rate-limits login,
  and a server that authenticated per tool call went red under demo load for
  reasons that had nothing to do with the UI. If a replay throws, the shared
  session is torn down so the next call starts clean.
- **Recompiling an app supersedes its own previous tools** rather than colliding
  with them. A name that collides with a *different* app's tool is namespaced
  `<app>_<name>`; `compile_app` itself is reserved.
- **A compile takes minutes, not seconds** — it drives a real browser. Clients
  with a short tool-call timeout need it raised.
