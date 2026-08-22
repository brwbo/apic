# apic

**Point it at a running web app. It explores the UI once, verifies what it
found, and emits a typed MCP server for an app that never had an API.**

```
$ npm run compile

  apic compile -> http://localhost:3456

  seed /projects
    * create project             [2p] creation - confirmed: "Success The project was…"
  seed /labels
    * create label               [1p] creation - confirmed: "Success The label was su…"
  seed /projects/21/85 (discovered)
    + create task (inline)       [1p] creation - confirmed: "apic probe 31953"

  5 candidate actions (5 with parameters)
  persistence: 2/2 survived a reload
  4 tools synthesised -> generated/vikunja/
```

Those tools are then callable with no model in the loop — a `fill`, a `click`
and a diff, ~4 seconds — and they keep working when the app moves, because the
compiler repairs them by re-running the build.

---

## The argument

**Playwright MCP interprets the app on every call. apic compiles it once.**

| compiler | apic |
|---|---|
| parse | agent explores the UI |
| IR | discovered affordances + preconditions |
| emit | typed MCP server |
| test suite | agent-verified tool calls |
| recompile on source change | self-heal when the UI moves |

Computer-use agents do not scale economically: every run re-derives the same
knowledge from pixels, paying model cost and latency per step, with reliability
compounding downward over a chain. That is why they are demoed constantly and
deployed rarely. The honest name for the market is RPA, and its universal
complaint is brittleness and maintenance cost.

apic is the amortisation. First contact with an app is exactly as slow as
before; every subsequent encounter is a function call.

---

## Setup

**Requires** Node (developed on v24.15.0), Docker, and a browser Playwright can
drive (`npx playwright install chromium`).

```bash
git clone https://github.com/brwbo/apic && cd apic
npm run setup
```

`scripts/setup.sh` copies `.env.example` to `.env`, starts the target
containers if they already exist, installs dependencies, and runs the doctor.
Create the target first if you have not (below).

**The target app.** The demo target is [Vikunja](https://vikunja.io) on
`localhost:3456` — a kanban app with no MCP server. It is a target, not a
dependency: `TARGET_URL`, `TARGET_USER` and `TARGET_PASS` in `.env` point apic
at anything you can log into.

```bash
docker run -d --name vikunja -p 3456:3456 \
  -e VIKUNJA_SERVICE_PUBLICURL=http://localhost:3456 \
  -e VIKUNJA_RATELIMIT_ENABLED=false \
  vikunja/vikunja
```

Disabling the rate limiter matters: Vikunja throttles the login route, and a
throttled login surfaces downstream as every tool failing at once — which is
indistinguishable from total drift, the one false positive a drift detector
must never emit.

**Keys are optional.** Every model-backed stage degrades to a deterministic
fallback, and a compile with an empty `.env` still works — that is how the
pipeline was built before any credentials arrived. `npm run doctor` reports
which stages are live.

```bash
# .env - gitignored, never committed
OPENAI_API_KEY=      # verify: the second-opinion judge          - in use
PIONEER_API_KEY=     # distill: change classification            - in use, billing-blocked
FAL_KEY=             # perceive: the vision escalation tier      - CLI compile only
HAI_API_KEY=         # explore: h picks the next gesture         - NOT REACHED, see below
```

Read [What is not true](#what-is-not-true) before believing that list. Three
of those four are not doing what a reader would assume.

## Commands

| command | what it does |
|---|---|
| `npm run doctor` | which keys are present, which stages are live, which endpoints answer |
| `npm run compile` | explore the target and emit `generated/<app>/` |
| `npm run verify` | replay every emitted tool cold; keep only what passes |
| `npm run score` | recall + precision against the target's own OpenAPI spec |
| `npm run watch` | re-run the suite on an interval, heal what breaks, print a status table |
| `npm run serve` | run apic itself as an MCP server (see below) |
| `npm test` | unit tests, no browser, no keys |

Add `--headed` to `compile` or `verify` to watch it drive.

## Use it as an MCP server

```bash
claude mcp add apic -- node /path/to/apic/src/server.js
```

The server starts with **one** tool, `compile_app`. Point it at a URL and it
runs the pipeline in-process, emits `generated/<app>/`, registers the compiled
tools **on itself**, and sends `notifications/tools/list_changed` — so they are
callable on the same connection, no restart. Verified from a cold start:

```
[apic] ready - 0 compiled tools + compile_app
BEFORE compile, tools/list = [ 'compile_app' ]
compile_app returned in 22.1s
list_changed notification: YES
AFTER compile = [compile_app, createProject, createLabel, updateLabel, createTask]
createLabel -> {"ok":true,"effect":"creation","expected":"creation"}
```

Full transcripts and the client-compatibility notes are in
[docs/mcp-client.md](docs/mcp-client.md).

### Both dead ends are answered, not reported

A client only meets apic at the moment something is missing.

**A tool that does not exist** returns the compile that would create it, rather
than a bare `unknown tool`:

```
unknown tool: createIssue

No compiled tool exposes that action (compiled so far: vikunja). If the app has no API for it, make one:

    compile_app { "url": "http://localhost:3456", "goal": "createIssue" }
```

**A tool the app has moved out from under** is repaired on the call path. The
tool goes red, the compiler re-explores that one action, the repair is written
back to disk, and the call is retried before the caller sees a failure:

```
[apic] createLabel is red (no control matched "ADD LABEL (RENAMED)") - re-exploring to heal it
[apic] createLabel healed in 13.6s (click "…" -> "create label"; selectors re-resolved); retry passed
{ "ok": true, "effect": "creation", "healed": { "ms": 13589, "persisted": true } }
```

A healthy tool is untouched by any of this: 4.4s, no re-exploration.

---

## How it works

| stage | file | what it does |
|---|---|---|
| explore | [`explore.js`](src/explore.js), [`discover.js`](src/discover.js) | drives a real browser, scopes affordances to main content, ranks them, tries the write-shaped ones |
| plan | [`plan.js`](src/plan.js) | ranks candidates and filters them through a board gesture model — keyless. [`h.js`](src/h.js) is the model-backed planner behind the same seam, and is **not currently reached** |
| perceive | [`perceive.js`](src/perceive.js) | DOM snapshot and diff before/after; escalates to a VLM only for changes the text cannot settle |
| distill | [`distill.js`](src/distill.js) | classifies each change (kind, destructive) and extracts domain nouns from the diff text |
| persist | [`persist.js`](src/persist.js) | reloads and looks for what was submitted — a displayed value is not a stored one |
| synthesize | [`synthesize.js`](src/synthesize.js) | trajectory + observed change -> typed tool schema, deterministic |
| emit | [`emit.js`](src/emit.js) | writes `generated/<app>/`: `tools.json`, a runnable `server.js`, a README with per-tool evidence |
| verify | [`verify.js`](src/verify.js) | replays every tool cold with fresh arguments; a deterministic diff floor, with an OpenAI judge as a stricter second opinion |
| heal | [`heal.js`](src/heal.js) | re-runs discovery at the tool's own seed and swaps in the fresh recipe |
| watch | [`watch.js`](src/watch.js) | the suite on an interval, healing what breaks |
| score | [`score.js`](src/score.js) | recall + precision against the target's own OpenAPI spec |
| serve | [`server.js`](src/server.js) | apic as a live MCP server |

**Three things make the output trustworthy rather than plausible.**

*Confirmation gates synthesis.* An action becomes a tool only when the app said
so — a success banner, or the submitted value echoed back somewhere it was not
typed. A click that changed pixels and nothing else is not a write.

*Persistence is checked by reload.* A value the SPA rendered optimistically and
a value the server stored look identical until you reload. `persist.js`
reloads.

*Verification replays cold.* `verify.js` calls every emitted tool again, from a
fresh session with fresh arguments, and drops the ones that cannot reproduce
their own effect. That is what `rejected` in `tools.json` records — with the
reason, in English.

**The repair path is the build path.** Healing does not patch a selector; it
re-runs discovery at that tool's seed and takes whatever the compiler finds
now. A renamed button still yields `createLabel`. This is the difference
between a compiler and a scraper.

---

## Results

Ground truth is Vikunja's own OpenAPI spec — **which apic never reads while
compiling.** The compiler only ever sees the UI. `score.js` extracts the 18
write operations in the board slice and scores what was emitted against them.

```
$ npm run score
  ground truth: 18 write ops in the board slice
  RECALL    8/18   (actions apic found)
  PRECISION 8/8    (emitted tools that are real)
```

**Started at 2/18 with precision 2/18. Finished at 8/18 with precision 8/8.**
Every change and what it bought is logged in
[docs/recall-log.md](docs/recall-log.md) — including the six ops still missed
and why each one is missed.

`verify.js` rejected one tool of nine: `markTask` observed a mutation but
nothing confirmed a write. The rejection and its reason stay in `tools.json`.

## What is not true

This section is the honest ledger. Everything above is reproducible; the
following is what a reader would reasonably assume and should not.

- **h is not reached.** `plan.js` exposes `nextLabel()` — the seam where h's
  Holo model chooses the next gesture from a screenshot — and **nothing calls
  it.** `discover.js` walks affordances and filters them through the keyless
  `gesture()` model instead. `HAI_API_KEY` passes the doctor's live check and
  then contributes nothing to a compile.
- **Tavily is not wired.** The `ground` stage — public docs -> domain
  vocabulary — is declared in `config.js` and reported by `doctor.js`, and was
  never built.
- **fal runs on the CLI path only.** `adjudicate()` is called from
  [`cli.js`](src/cli.js), not from [`compile.js`](src/compile.js) — so a
  compile driven through the MCP server captures frames and never escalates to
  the vision tier. It is an escalation tier either way: it fires only for steps
  the DOM text could not settle, which on Vikunja is most often none of them.
- **Pioneer is billing-blocked.** The integration is live in both paths, and
  currently returns `HTTP 403 payment_method_required`, so every compile falls
  back to the node-count heuristic. That is why the emitted tools all record
  `"discoveredBy": "heuristic"`.
- **So the numbers below were produced keyless.** Recall 8/18 at 100% precision
  is the deterministic pipeline's score, with an OpenAI judge on the verify
  pass. It is not a demonstration of the partner stack.
- **One app is proven.** `generated/gitea/` compiled to **zero** tools. Vikunja
  works; generalisation is unproven.
- **Watch treats every failure as drift.** Real flake-vs-drift classification
  does not exist. The counters in `out/watch-stats.json` were recorded before
  the provenance fix in `heal()` and their break/repair ratio reflects that bug,
  not the current behaviour.
- **The emitted per-app `server.js` is the plain version** — it replays tools
  and reports failures. Healing on the call path lives in `src/server.js`, the
  live compiler server.
- **A compile takes minutes** — it drives a real browser. Clients with a short
  tool-call timeout need it raised.

## Partner technologies

| tech | stage | what it does | status |
|---|---|---|---|
| **OpenAI** | verify | structured-output judge over the replay diff, layered on the deterministic floor. It can uphold a rejection, never overturn one | **in use** — it weighed in on the one tool `verify` rejected |
| **Pioneer** | distill | GLiNER2 encoder over the diff text — classifies state change and destructiveness, extracts domain nouns. One batched call per compile | **integrated, blocked** — `403 payment_method_required`, falls back to the heuristic |
| **fal** | perceive | VLM over before/after frames, for changes the DOM text cannot settle — a card that moved column, a control that merely lit up | **CLI path only**, and only for steps text could not settle |
| **h** | explore | `holo3-1-35b-a3b` reads a screenshot and the candidate list and picks the next gesture to try | **integrated, not reached** — `nextLabel()` has no callers |

Every one of them degrades rather than fails: no key, a dead endpoint or an
unparseable answer leaves the deterministic classification standing. A blind
judge must never fail a compile. That property is why the pipeline was
buildable before any credentials arrived — and it is also why three of these
four could stop contributing without the compile noticing, which is exactly
what happened.

The intended economy: `fal` as the cheap high-frequency perception layer,
OpenAI as the expensive low-frequency reasoning layer — the same
escalate-on-failure-not-on-every-call principle the product is built on. Only
half of that is wired today.

## Related work

- **[Playwright MCP](https://playwright.dev/mcp/introduction)** — the nearest
  thing. Generic verbs (`click(ref)`) against app-specific nouns
  (`createTask(title)`); runtime against compile time.
- **[Apify MCP Server](https://github.com/apify/apify-mcp-server)** —
  auto-generates typed per-app tools, from human-authored Actor input schemas.
  apic derives the contract by operating the software.
- **Easy MCP** (Microsoft) — OpenAPI spec to MCP tools. Requires the API to
  already exist.
- **[WebMCP](https://github.com/webmachinelearning/webmcp)** — pages declare
  their own tools. Requires the page's author to cooperate; apic's wedge is
  software whose authors will not.
- **Alita** (arXiv 2505.20286) and **Alita-G** (arXiv 2510.23601) — agents that
  generate and reuse MCPs per task. Closest published framing. Alita synthesises
  tools from what it *reads*; apic derives them from what it *does*.
- **[AgentDistill](https://arxiv.org/pdf/2506.14728)** — training-free agent
  distillation with generalizable MCP boxes.
- **Voyager**, CREATOR, LLMs as Tool Makers — the ancestors of the
  write-verify-keep loop.
- **[healwright](https://libraries.io/npm/healwright)** — self-healing
  selectors. Heals hand-written tests; apic heals a generated API.

## Layout

```
src/           the compiler
generated/     compiled apps - tools.json, a runnable server.js, evidence
docs/          recall log, MCP client notes
tests/         unit tests, no browser
scripts/       setup
out/           scratch: trajectories, raw model output, watch stats (gitignored)
```

MIT.
