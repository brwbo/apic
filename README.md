# apic

**An app-to-API compiler.** Point it at a web app that has no API for agents. A
computer-use agent explores the UI, verifies what it found by executing it, and
emits a typed MCP server for the app.

> Playwright MCP *interprets* the app on every call. apic *compiles* it once.

Built solo in one day at the [{Tech: Europe} × VEED Hackathon](https://techeurope.notion.site/techeuropexveed),
London, 22 August 2026.

**→ [apic-ui.vercel.app](https://apic-ui.vercel.app) — the demo video is there,
along with what each partner model decides and what the compiler measured.**

## Public consumer sites

`apic --read https://example.com` compiles the public, read-only surface of any
consumer site into MCP tools. It begins at that site (plus optional same-site
seeds), discovers search boxes, filters and repeated result cards, then emits
only tools whose rows survive a cold replay. It does not assume Deliveroo
routes, restaurant vocabulary, an account, a basket or checkout.

For a known collection/item page, pass it explicitly as a same-site direct
seed: `APIC_READ_DIRECT_URL=https://example.com/catalog/item apic --read https://example.com`.
Agent-supplied URLs are constrained to the origin compiled into the recipe.

### One prompt, no target URL

When APIC is connected as its MCP server, use `fulfill_request` instead of
`compile_app` for a normal consumer question:

```json
{ "request": "Find me the cheapest pizza near 17 & 18 Clere Street" }
```

The server uses Tavily to find public candidate services, OpenAI to select and
operate the compiled flow, h to prioritise ambiguous read controls, Pioneer to
classify whether probes surfaced meaningful results, and fal only where that
classification needs visual adjudication. It tries a small origin-distinct
fallback set if a candidate is challenged or has no replayable public flow.
It never logs in, orders, checks out, or bypasses a challenge. The surviving
tools are cold-verified, returned as evidence, and registered on the same MCP
server for later calls.

---

## Demo

**[Watch it on the site: apic-ui.vercel.app](https://apic-ui.vercel.app/#demo)** —
two minutes, unedited: the compile, the generated tools appearing in a live
session, and the watcher catching a UI change on its own.

The same site carries the numbers this README reports, the per-partner
breakdown, and the install snippet for every MCP client.

## The problem

Computer-use agents don't scale economically. Every run re-derives the same
knowledge from pixels: a model round-trip per step, a page snapshot per step
filling the context window, and reliability that compounds downward over a
chain. Which is why they're demoed constantly and deployed rarely.

The software agents most need to drive is exactly the software least likely to
ever ship an API — internal tools, legacy systems, anything whose vendor is
gone. You can't sniff a network tab that has nothing on it, and you can't ask a
2011 line-of-business app to adopt a new protocol.

apic uses the expensive agent **once**, to write the interface. After that it's
a function call.

## How it works

| Stage | Does | Tech |
|---|---|---|
| **Ground** | Reads the target's own documentation and learns that app's nouns, so the vocabulary is not hardcoded to Vikunja's | Tavily + OpenAI, cached per host — CLI path only |
| **Explore** | Drives the app, ranks affordances so create actions go first, opens forms and submits them | Playwright + [h](#partner-technologies) (escalation tier for controls the vocabulary can't name) |
| **Perceive** | Decides whether anything meaningful changed | DOM diff, escalating to fal on the CLI path |
| **Synthesise** | Turns a trajectory into a typed tool schema | deterministic — no model call |
| **Verify** | Replays the tool cold with arguments the app has never seen | keyless diff floor, then the fine-tuned Pioneer judge, with OpenAI on standby |
| **Emit** | Writes a runnable MCP server, its schemas, and its evidence | — |
| **Watch** | Re-runs the suite on an interval | — |
| **Heal** | A red tool re-enters discovery at its own seed | — |

**The repair path is the build path.** Healing doesn't patch a selector — it
re-runs the discovery that found the tool in the first place and matches by the
name synthesis produces. A renamed button still yields `createProject`.

### A tool exists only if the app confirmed the write

Counting DOM nodes produces a plausible-looking tool for every button on the
page. apic emits one only when the app itself asserts that state changed, via
three signals covering three different app behaviours:

| Behaviour | Example | Signal |
|---|---|---|
| announce-and-stay | create a label | success banner in a status region |
| announce-and-navigate | create a project | banner survives the URL change |
| silent-append | kanban quick-add | the submitted value appears as rendered content |
| relocation | drag a card between columns | the card changed container |

Relocation matters because a drag has no banner and echoes nothing — the card
already existed. Containment change *is* the evidence, and no cosmetic
re-render can produce it.

### Recipes bind to identity, not location

Vikunja regenerates element ids on every page load, so a stored selector is dead
on arrival. A recipe records what a field **is** — its label, placeholder, name —
and replay re-resolves it live, falling back to a stable-first selector chain
(`name` → stable id → placeholder → generated id last).

## Results

Compiled from the UI. **The target's OpenAPI spec is never read during
compilation** — it is used only as ground truth for scoring, which is why the
recall number means anything at all.

**The denominator, stated before the number:** 18 is every write operation
(`POST`/`PUT`/`DELETE`) on `/projects`, `/tasks` and `/labels` in Vikunja's own
OpenAPI spec, after removing what is not a board gesture — teams, project-level
permissions, link sharing, attachments, task relations, duplication, bulk
endpoints and read receipts. Vikunja publishes 105 write operations in total;
18 is the subset a person can perform on a Kanban board, and each emitted tool
may claim at most one of them, so recall cannot be inflated by loose matching.

```
RECALL     8/18    of the board write-ops in the target's own API
PRECISION  9/9     emitted tools that map to a real operation
VERIFIED   9/9     survived a cold replay with arguments never seen before
```

Nine tools discovered, nine served. Rejected tools are not deleted — they stay
in `tools.json` with `verified: false`, because **a rejected tool is evidence
about the compiler, not garbage.**

**`markTask` is flaky and that is worth more than the 9/9.** Two consecutive
verify runs against the same bundle, no changes in between, gave 8/9 then 9/9:
it failed with *"observed mutation but nothing confirmed a write"* and then
passed with *"Success — the task was saved successfully."* The likely cause is
the seeded task's state — land on one already done and the control reads MARK AS
UNDONE and confirms differently. It takes no parameters, so it cannot
disambiguate by argument either.

That is a **live instance of the flake-vs-drift problem** listed below as
unsolved: `watch` would count that failure as drift and call `heal`, when
nothing drifted at all.

Continuous verification over a live afternoon:

```
327 checks · 118 breaks · 3 automatic repairs · MTTR 20s
```

(`out/watch-stats.json`, 38 cycles from 11:33 BST, still running as this was
written — the counters move.)

Read that break count for what it is. `stats.breaks++` fires on every red
replay in every cycle, so three tools that stay red across 38 cycles read as
~114 breaks — it is a red-tool-cycle count, not 118 separate drift events. And
this watcher was started at 11:33, before the fix to `heal()`, which returned a
repaired recipe without the fresh `provenance` that `replay()`'s opener
actually clicks by; a tool whose control had been renamed therefore healed on
every cycle and went green on none. That is most of the 6/9. Fixed in the code,
not re-gathered over a comparable window.

## Partner technologies

Each one has a stage, and each degrades rather than blocking: the whole
pipeline runs with **no API keys at all**, at reduced fidelity. That property
is why the compiler was buildable before any credentials arrived — and it is
also why an integration can stop contributing without the compile noticing,
which is what the status column records.

| Tech | Stage | Why it earns its place | Status |
|---|---|---|---|
| **OpenAI** | Verify | An independent verdict on whether the predicted effect occurred, layered on the keyless diff floor. It can uphold a rejection, never overturn one | **in use** — it ruled on the one tool `verify` rejected |
| **fal** | Perceive | Fast VLM for meaningful-vs-cosmetic judgement, escalated to only when the DOM diff is ambiguous | **in use** — 4/4 escalated steps judged last compile, 2 of them ruled cosmetic. CLI path only; `compile_app` does not escalate |
| **Pioneer** | Verify, Distil | **A GLiNER2 encoder fine-tuned on apic's own verify evidence replaces the GPT-4.1-mini judge** — and beats it on held-out tools (below). Also the diff-text classifier in `distill.js` | **in use** — `PIONEER_JUDGE_MODEL` set: the live `verify` pass above was judged by the fine-tuned encoder, 8/9, every verdict in 106–183 ms |
| **h** | Explore | Reads the page and names the write actions the keyless vocabulary refused | **in use** — runs once per seed on the leftovers; names 0 of 3 on Vikunja, correctly |
| **Tavily** | Ground | App documentation → domain vocabulary, so tools are named `createIssue`, not `btn_submit_2` | **in use** — `ground.js` runs before the first seed; additive to the built-in table, cached per host, CLI path only |

The two-tier split is the product's own thesis applied to itself: **fal is the
cheap high-frequency perception layer, OpenAI is the expensive low-frequency
reasoning layer.** Escalate on failure, not on every call.

### How each one is actually called

**h — `holo3-1-35b-a3b`, `api.hcompany.ai/v1` (OpenAI-compatible).**
`gesture()` maps a control's visible text to a `<verb, resource>` pair with
regexes and returns `null` for everything else. That null is the precision gate
and it is also where recall goes: an icon-only button, a control that does not
lead with a verb, or an app whose wording the vocabulary never anticipated is
dropped however plainly it writes. h is the escalation tier for exactly that
set — [`discover.js`](src/discover.js) `classify()` sends a JPEG of the page and
the refused controls, once per seed, and asks which of them write.

Three things stop that costing precision. Answers are validated against the
closed vocabulary — six verbs, four resources — by `plan.gestureFrom()`, so an
invented verb cannot name a tool. Off-slice controls are withheld rather than
offered, because excluding `ADD TO FAVORITES` is a scoping decision and not a
gap for a model to fill. And a classified control still has to make the app
confirm a write like every other candidate.

*Measured, on the compile this README reports:* h reads the three controls the
vocabulary leaves unresolved on Vikunja's task page and names **one** of them —
an icon-only control the regexes drop outright:

```
! h read 3 unresolved controls, named 1
! h: "Kanban bucket: To-Do" -> move task (Pencil icon allows changing task status)
```

That is the escalation tier doing the job it exists for: a control with no
leading verb and no usable text, recovered from its icon and mapped into the
closed vocabulary.

**It did not add a tool, and we are not claiming it did.** `move task` had
already been found twice by then — once by the board drag (`Move card between
columns`), once by the task page's bucket dropdown (`Kanban bucket: Doing`) —
so h's answer deduplicated into the `moveTask` that the drag produced. On this
target h is corroboration, not recall: a third independent route to an action
two other routes already reached. An earlier revision of this file said h was
never reached and named none; both were wrong.

Whether h *adds* recall is untested here, because Vikunja's writes are unusually
well-labelled. The case it is built for — an app whose buttons are icons — is
exactly the case this target does not present. Without the key the compile
loses that corroboration and nothing else.

**fal — `google/gemini-2.5-flash-lite` via `fal-ai/any-llm/vision`.**
The DOM differ says *whether* the page changed. It cannot settle a change the
text does not describe — a card that moved column, a control that merely lit
up. [`perceive.js`](src/perceive.js) `adjudicate()` escalates those steps, and
only those, to pixels.

*Measured, from the last full compile:* `vision: 4/4 escalated steps judged by
fal, 1 drag corroborated, 2 found cosmetic`. The two cosmetic verdicts are the
interesting half — fal removing candidates that would otherwise have been
probed as writes. It runs from `cli.js`; a compile driven through `compile_app`
on the MCP server does not escalate.

**OpenAI — `gpt-4.1-mini`, structured output.**
[`verify.js`](src/verify.js) replays every emitted tool cold with arguments the
app has never seen, and judges the result twice: a deterministic diff floor
first, then the model. **The model can uphold a rejection and never overturn
one** — a tool the diff could not confirm stays rejected however confident the
judge is.

*Measured:* on the run where `markTask` failed, its record reads
`openai/gpt-4.1-mini disagreed but cannot overturn a rejection`. That asymmetry
is deliberate: a judge that can promote its own guesses is a precision leak.

**Pioneer — GLiNER2 (`fastino/gliner2-base-v1`), one `POST /inference` per step.**
[`distill.js`](src/distill.js) sends each step's diff text on its own request
and gets back a state-change class, a destructive flag and the domain nouns,
above a 0.6 confidence threshold. It used to batch the whole trajectory, and
batching is what the third hard-won lesson below is about: the same text scored
`creation` 0.777 alone, `creation` 1.000 at position 0, and `DELETION` 0.600 at
position 2 of the reversed batch — a wrong label clearing the threshold. A completed training-job id in
`PIONEER_MODEL` swaps the base encoder for a checkpoint fine-tuned on apic's own
labels — the system compiling its own perception layer — and nothing else
changes.

**Pioneer — the fine-tuned verify judge.** This is the Pioneer side-challenge
entry: *fine-tune a model that outperforms or replaces a general-purpose LLM
API call.* The call it replaces is `judgeModel()` in
[`verify.js`](src/verify.js) — GPT-4.1-mini, a 200-word system prompt,
structured output, one question per replayed tool: *given this DOM diff, did
the predicted write demonstrably happen?* That is a two-label text
classification wearing a chat completion.

[`pioneer-train.js`](src/pioneer-train.js) builds the replacement from the
product's own exhaust, with no hand labelling:

1. **collect** — replay every compiled tool six times with fresh arguments
   through `verifyAll()`, recording the evidence and the verdict the shipped
   judge (diff floor + GPT) gave it. 54 real rows.
2. **dataset** — derive negatives by deleting the evidence the floor keys on
   (banner gone, echo moved into the input that typed it, argument unfilled,
   replay threw, nothing changed) and positives that preserve the label
   (node order reversed, unrelated nodes added, arguments renamed to values a
   person would type). Every derived row is relabelled by the same
   deterministic floor. 788 rows; **held out by tool**, so the bench measures
   tools the encoder has never seen.
3. **upload / train** — `POST /felix/datasets/upload/url` → presigned PUT →
   `POST /felix/training-jobs`, `fastino/gliner2-base-v1`, LoRA, 12 epochs.
   Trains in about four minutes.
4. **bench** — the held-out rows through both judges. The LLM is called via
   the unchanged `judgeModel()`, so it sees exactly what it sees in production.

| judge | accuracy | precision | recall | false pos | false neg | ms/row |
|---|---|---|---|---|---|---|
| **Pioneer GLiNER2 fine-tune** (job `91370379…`) | **94.4%** | **100%** | 87.6% | **0** | 12 | **150** |
| OpenAI GPT-4.1-mini | 89.3% | 84.3% | **93.8%** | 17 | 6 | 890 |

215 held-out rows, two tools (`createTask`, `assignLabel`) absent from training.
The encoder gives up some recall for zero false positives — the right trade
for this judge, which by design may uphold a rejection but never promote a
guess. Set `PIONEER_JUDGE_MODEL` to the job id and `verify` uses it; OpenAI
stays on standby as the fallback, and with no keys at all the floor still runs.

Three things learned the hard way, all verified live and recorded in the code:
`multi_label`/`top_k` inside a classification spec make the unified
`/inference` path return `categories: []` for every text (this, not credit,
is why the distil stage was silent all morning); GLiNER2 trains as LoRA only —
`training_type: "full"` is accepted and fails inside Modal with no log line;
and batch inference (`text: [...]`) on a fine-tuned model returns labels that
do not line up with the inputs, so the judge sends one text per request.

**Tavily — `api.tavily.com/search`, five results, answer included.**
[`ground.js`](src/ground.js) runs before the first seed. `plan.js` ships
Vikunja's nouns — bucket, task, label, project — and pointed at anything else
`gesture()` is asked about issues and repositories by a table that has never
heard of them, returns null, and the control is dropped. Tavily fetches the
target's own documentation; OpenAI structures that prose into a closed noun set
under a strict schema; every term is validated against `/^[a-z][a-z-]{1,18}$/`,
capped at 12, and **merged into** the built-in table rather than replacing it,
so grounding can add vocabulary and can never take Vikunja's away. Cached per
host under `.apic/`, so a repeat compile spends nothing and a demo does not
depend on venue wifi.

It degrades in three steps — no Tavily key, no evidence; no OpenAI key, the
evidence cannot be structured; nothing survives validation — and each one logs
and leaves the built-in table standing. Like fal, it runs from `cli.js`:
`compile_app` on the MCP server uses the built-in vocabulary.

**So the recall figures above were produced keyless**, with fal on the
escalated perception steps and an OpenAI judge on the verify pass. They are not
a demonstration of the full partner stack, and this README will not pretend
otherwise.

## Setup

```bash
git clone https://github.com/brwbo/apic && cd apic
npm install && npx playwright install chromium
cp .env.example .env      # fill in keys; .env is gitignored
npm run setup             # starts the target app, checks every credential
```

Target app (self-hosted, disposable — never point this at a third party's
product):

```bash
docker volume create vikunja-files
docker run --rm -v vikunja-files:/data alpine sh -c "chown -R 1000:0 /data"
docker run -d --name vikunja -p 3456:3456 -v vikunja-files:/app/vikunja/files \
  -e VIKUNJA_SERVICE_PUBLICURL=http://localhost:3456 \
  -e VIKUNJA_DATABASE_PATH=/app/vikunja/files/vikunja.db \
  -e VIKUNJA_RATELIMIT_ENABLED=false \
  vikunja/vikunja:latest
```

| Command | Does |
|---|---|
| `npm run doctor` | Which credentials work, which targets are up |
| `npm run compile` | Explore → synthesise → emit |
| `npm run verify` | Replay every tool cold; only survivors are served |
| `npm run watch` | Continuous verification with automatic repair |
| `npm run score` | Recall and precision against the target's real API |
| `npm run serve` | Run **apic itself** as an MCP server — see below |

Every command reads the same two variables, so a whole run can be pointed at an
alternative bundle without touching the live one:

```bash
APIC_OUT_DIR=out/rescue APIC_APP=vikunja npm run verify
```

| Variable | Default | Meaning |
|---|---|---|
| `APIC_OUT_DIR` | `generated` | Where compiled bundles live. `APIC_GENERATED` is accepted as an alias |
| `APIC_APP` | `vikunja` | Which bundle inside it |
| `TARGET_URL` | `http://localhost:3456` | The app being compiled |
| `TARGET_USER` / `TARGET_PASS` | `apic` / — | Credentials for the target |
| `TARGET_LOGIN_PATH` | discovered | Only needed when the login form is not on a `/login`-style path |
| `APIC_SEEDS` | `/projects,/labels` | Pages to start exploring from |

Seeds and target are environment-driven — nothing in the compiler knows
Vikunja's routes:

```bash
APIC_APP=gitea TARGET_URL=http://localhost:3001 APIC_SEEDS=/repo/create,/issues npm run compile
```

## Generated output

[`generated/vikunja/`](generated/vikunja) — server, schemas, and the evidence
for each tool. **Nothing in that directory was written by a human.**

## Use it as an MCP server

```bash
claude mcp add apic -- node /path/to/apic/src/server.js
```

`src/server.js` starts with **one** tool, `compile_app`. Point it at a URL and
it runs the pipeline in-process, emits `generated/<app>/`, registers the
compiled tools **on itself**, and sends `notifications/tools/list_changed` — so
they are callable on the same connection, with no restart. From a cold start:

```
[apic] ready - 0 compiled tools + compile_app
BEFORE compile, tools/list = [ 'compile_app' ]
compile_app returned in 22.1s
list_changed notification: YES
AFTER compile = [compile_app, createProject, createLabel, updateLabel, createTask]
createLabel -> {"ok":true,"effect":"creation","expected":"creation"}
```

A compiler that needs you to restart the thing it just extended is a build
step. One that doesn't is a live compiler. Client-compatibility notes and full
transcripts: [docs/mcp-client.md](docs/mcp-client.md).

### Both dead ends are answered, not reported

A client only meets apic at the moment something is missing, and both of those
moments used to end the conversation.

**A tool that does not exist** returns the compile that would create it:

```
unknown tool: createIssue

No compiled tool exposes that action (compiled so far: vikunja). If the app has no API for it, make one:

    compile_app { "url": "http://localhost:3456", "goal": "createIssue" }
```

**A tool the app has moved out from under** is repaired on the call path —
`watch` heals on a timer, the server heals on demand, through the same
`heal()`. The tool goes red, the compiler re-explores that one action, the
repair is written back to `tools.json`, and the call is retried before the
caller sees a failure:

```
[apic] createLabel is red (no control matched "ADD LABEL (RENAMED)") - re-exploring to heal it
[apic] createLabel healed in 13.6s (click "…" -> "create label"; selectors re-resolved); retry passed
{ "ok": true, "effect": "creation", "healed": { "ms": 13589, "persisted": true } }
```

A healthy tool is untouched by any of this: same call, 4.4s, no re-exploration.

## Related work, and how this differs

| Project | What it does | The difference |
|---|---|---|
| [Playwright MCP](https://playwright.dev/mcp/introduction) | Browser automation as typed MCP tools | Generic verbs (`click(ref)`) vs app-specific nouns (`createTask(title)`). Runtime vs compile time |
| [Apify MCP Server](https://github.com/apify/apify-mcp-server) | Auto-generates typed tools from Actor input schemas | Actors are human-authored — it generates the *wrapper* from a human-written contract |
| [Apify AI Web Scraper](https://apify.com/apify/ai-web-scraper) | URL + plain English → structured data | Returns data, not an interface, and re-runs the LLM every call |
| [cli-printing-press](https://github.com/mvanhorn/cli-printing-press) | URL/HAR/OpenAPI → CLI + MCP server, with verification gates | Sniffs network traffic — the app must already have an API. apic drives the UI |
| [Easy MCP](https://techcommunity.microsoft.com/blog/appsonazureblog/app-service-easy-mcp-add-ai-agent-capabilities-to-your-existing-apps-with-zero-c/4484513) | OpenAPI spec → MCP tools | Requires the API to already exist |
| [Alita](https://huggingface.co/papers/2505.20286) | Agent generates and reuses MCPs per task | Generates tools by searching the web. apic derives them by operating the software |
| [WebMCP](https://github.com/webmachinelearning/webmcp) | Pages declare their own tools in JavaScript | Requires the app's developers to adopt it |
| [Voyager](https://llm-agent-tutorial.github.io/website/voyager.html) | Write a skill, verify it, store it, reuse it | The ancestor of the verify-then-keep loop |

**The loop is not novel — where the capability comes from is.** Alita reads the
internet to make tools; cli-printing-press reads the network; Easy MCP reads a
spec. apic reads the app.

## What doesn't work yet

Stated plainly, because a compiler that hides its failure modes isn't one.

- **h is in the path and contributes nothing on this target.** It reads the
  controls the vocabulary refused and correctly names none of them, because
  Vikunja's board slice is already covered by the regexes. The escalation is
  real and measured; the gain is zero here, and a target whose controls are
  icons rather than verb phrases is the case that would show it.
- **`compile_app` runs a reduced pipeline.** [`compile.js`](src/compile.js) is
  the in-process compile the MCP server calls, and it is `cli.js` minus five
  things: grounding (Tavily/OpenAI), seed discovery, the dedicated form-page
  probe, the task-detail seed and the Kanban drag, plus fal's vision tier —
  `adjudicate()` runs from `cli.js` only. It keeps discovery, persistence,
  Pioneer distillation, synthesis and emit. That is why the transcript above
  shows four tools where `npm run compile` produces nine: **the live-compiler
  demo and the 9-tool bundle are two different paths**, and only the CLI one
  is what the recall figures describe.
- **Pioneer looked unavailable all morning** — first `403
  payment_method_required`, and after a new key, `categories: []` on every
  call, which the code read as "no opinion" and fell through to the heuristic.
  The second was a request-shape bug (`multi_label`/`top_k`), not the API. Each
  integration was written to degrade silently, and each did — the degradation
  is the intended behaviour; not noticing for a whole morning is not.
- **The fine-tuned judge has seen one app.** Its 788 training rows are all
  Vikunja. The held-out split is by tool, not by app; a Gitea or ParaBank bench
  is the next honest test, and `collect` against a second target is how to
  get it.
- **The second target compiles thinly.** Gitea now compiles end to end —
  `createRepository` and `createIssue`, both verified, **2/13 on its issue
  slice** against `swagger.v1.json`. It took no change to discovery: the two
  fixes were a confirmation class (Gitea confirms a write by *serving the
  result at a new URL* carrying the submitted value, and the gate only looked
  for banners and body echoes) and moving the container/item URL patterns out
  of `cli.js` into configuration, where `APIC_SEEDS` already lived. Label and
  comment actions are still missed: they sit behind controls the vocabulary
  does not name, and `h` named none of the 14 it was handed.
- **8/18 recall on Vikunja.** Missing: bucket creation, comments, relations and attachments.
- **`markTask` fails roughly one run in two** (see Results). The effect is real
  and observed; whether anything *confirms* it depends on the task's existing
  state. Any live `npm run verify` should be expected to print 8/9 or 9/9.
- **Concurrent runs collide.** Every command shares one stored session at
  `.apic/session.json`, so a compile and a verify started together can destroy
  each other's browser context mid-run (`Error setting storage state: Execution
  context was destroyed`). Pass a distinct `APIC_SESSION` per run as a
  workaround; the real fix is a per-run session file by default.
- **Watch treats every failure as drift.** Real flake-vs-drift classification
  doesn't exist. Three false-positive classes were fixed by hand — rate
  limiting, token expiry, and a crashed page — but the general problem stands.
- **Semantic change is undetected and dangerous.** If `deleteProject` starts
  archiving instead of deleting, healing the selector is the *wrong* answer.
  Verification checks that an effect occurred, not that it's the same effect.
- **No inverse actions**, so the suite pollutes its own fixture. Repeated runs
  degrade the target until it's reset.
- **Auth is sidestepped.** One login, one user, no permission scopes — which is
  the hard part of the problem in real enterprise software.

## Prior work declaration

Written from scratch at the hackathon. No boilerplate carried in; the repo was
created empty on the morning of the event. Playwright, the MCP SDK, and the
OpenAI and fal clients are the only dependencies.

## Licence

MIT
