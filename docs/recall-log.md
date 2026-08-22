# apic recall log

Ground truth: **18 write ops** in the Vikunja board slice, taken from the app's
own OpenAPI spec (`/api/v1/docs.json`) — which apic never reads while compiling.
The compiler only ever sees the UI.

Board slice that matters: create project, create task, rename task, assign
label, move task between buckets, mark done, delete task.

| # | change | recall | precision |
|---|--------|-------:|----------:|
| 0 | baseline | **2/18** | 2/18 |
| 1 | scope affordances to main content | 2/18 | 2/4 |
| 2 | board gesture model gates every candidate | 2/18 | 4/4 |
| 3 | task detail page: rename / done / label / delete | 5/18 | 5/5 |
| 4 | aria-label controls + bucket dropdown | 6/18 | 7/7 |
| 5 | rename verified by reload | 7/18 | 8/8 |
| 6 | expired-session detection + kanban drag merged | **8/18** | **9/9** |

**Started at 2. Finished at 8, with precision at 100%.**

Recall stopped moving there. What happened next is the half that does not show
up in the number: five partner technologies went from three-declared-two-dead to
five that all do real work, and the compiler stopped emitting tools it could not
replay. Second table, further down.

---

## 0 — baseline: 2/18, precision 2/18

Only `createProject` and `createLabel` were real. Sixteen of the eighteen
emitted tools were junk: `doOverview`, `doInbox`, `doPoweredByVikunja`,
`doApicProbe48902` and a dozen siblings. So there were two problems, not one —
recall *and* precision.

## 1 — the sidebar was 80% of the search space

`affordances()` walked the whole document: ~190 clickable elements, ~150 of them
the sidebar, which is identical on every page and contains one entry per
project — so every project a *previous probe run had created* came back as a
fresh candidate action. Scoping to `main` and excluding `aside`/toolbars cut
190 candidates to between 5 and 21. Links to resource instances (`/tasks/176`)
were reclassified as *seeds*, not actions: they are content somebody created,
not a control the app exposes.

Also rewritten as a single `page.evaluate` instead of one `innerText` round-trip
per element, which was most of the wall-clock cost of a compile.

## 2 — a control that maps to no board gesture is not an action

New in `plan.js`: `gesture(text, { scope })` maps a control's visible text plus
the page it was found on to a canonical `<verb, resource>` pair, and returns
**null** for anything that is not a board write. That null is the precision gate.

It also disambiguates by page: `ADD LABELS` on a project page creates a label;
on a task page it attaches one to that task. Same words, different write.

The canonical phrase becomes the action's label, so the emitted tool is
`markTask`, not `markTaskDone` — while the raw UI string is kept as `control`
and travels into the evidence, so replay still knows what to click.

Precision reached 100% here and has stayed there.

## 3 — the whole back half of the board is one click deeper

Rename, mark done, assign label and delete all live on `/tasks/{id}`, a page
button-first probing never reaches: you only get there by following a task
somebody created. `discoverTask()` seeds it with the task apic created itself,
so the destructive gestures are run against apic's own row — and run last.

None of the five is a plain form: one is a `contenteditable` heading, one is a
dropdown, one needs a confirmation modal whose button says `DO IT!` (not a
submit verb, so `confirmButton()` looks for it separately, and only inside a
dialog).

## 4 — two controls that were invisible

**The title field.** `fields()` required a `name`, `id` or `placeholder` to build
a selector. Vikunja's task title is `<h1 contenteditable aria-label="Title">` —
none of the three. It was dropped, so rename had no field and was undiscoverable.
`aria-label` is now part of the locator chain.

**The bucket selector.** `affordances()` names controls by `aria-label` first,
but `open()` clicked by *visible text*. The bucket dropdown renders as a button
reading `To-Do` whose aria-label is `Kanban bucket: To-Do`, so the single most
visually obvious action on a Kanban board was silently unclickable. `open()` now
tries both handles.

## 5 — a rename the differ could not see

Renaming worked — `POST /tasks/276` fired every time — but the diff reported
"no change". `snapshot()` names every element by `aria-label` first, so the
title element recorded as `h1||Title` both before *and* after: the label is
stable, only the text changes, and the text was never captured.

Rather than reach into the perception layer (another session owns it), rename is
now **verified by reload**: set the title, blur, load the page fresh, and check
the value came back. A title that survives a page load was persisted by the
server — stronger evidence than any DOM comparison.

## 6 — the compile had been silently unauthenticated

`ensure()` treated "not on `/login`" as proof of a session. It is not. A stored
session whose refresh token has expired still renders the entire app: the SPA
boots from localStorage, never redirects, and only the *writes* fail — 401 on
`/user/token/refresh`, every create turning into a generic `Error / unexpected`
toast. Downstream that reads as "the app rejected this action", so discovery
quietly loses every write it attempts. `ensure()` now watches for the 401.

Merged in this pass: `kanban.js`'s drag-based `discoverMove` (another session's
work) now runs on the board view and is canonicalised to `move task`, so
bucket-move is confirmed twice over — once by drag relocation, once by the
task-page dropdown.

---

# Part two: making the number mean something

Recall held at 8/18 through all of this. Precision held at 100%. That is the
point - none of it was chasing the metric, and the metric proves none of it
broke anything.

| # | change | tools | recall | precision |
|---|--------|------:|-------:|----------:|
| 7 | fal wired as the vision escalation tier | 9 | 8/18 | 9/9 |
| 8 | controls that vanish are not capabilities | 9 | 8/18 | 9/9 |
| 9 | never reject on a probe that could not tell | 9 | 8/18 | 9/9 |
| 10 | vocabulary grounded in the app's own docs | 9 | 8/18 | 9/9 |
| 11 | Pioneer: 0 classifications to 7-13 | 9 | 8/18 | 9/9 |

## 7 — fal, and only where text cannot decide

`distill.js` already described this seam - *"fal stays as the escalation tier for
the cases the DOM text genuinely cannot settle"* - and flagged the steps for it.
Nothing was on the other end. `@fal-ai/client` was a dependency, `FAL_KEY` was in
config and doctor, `perceive.js`'s header described a VLM, and no code called it.

A VLM on every step would be slow and mostly wasted, because most steps announce
themselves: when the app says *"The task was deleted successfully"*, the text IS
the evidence and a screenshot adds nothing. So `perceive.js` now records **how** a
write was confirmed, and only the weak ones escalate:

| `via` | meaning | escalates? |
|---|---|---|
| `banner` | a toast naming the outcome | no - authoritative |
| `reload` | the value came back on a cold page load | no - authoritative |
| `echo` | the submitted value is on screen somewhere | **yes** |
| *(none)* | the kind came from counting nodes | **yes** |

That `echo` split is what makes fal matter rather than decorate. An echo proves
*a* write happened but not *what kind* - it always reports `creation`, because
that is all it can infer. Without separating it from a real toast, fal would have
judged only the steps `synthesize` discards, and been inert.

`fal-ai/any-llm/vision` takes `image_urls` as a list, so before and after go in
as two frames with no compositing, and it accepts data URIs inline - one request,
not an upload plus a request. ~30-50KB per frame at JPEG q55, ~2.5s.

A drag is corroborated, not reclassified. `kanban.js` proves relocation
structurally and `replay.js` re-checks it the same way, so `relocation` is more
precise than any of the five kinds fal knows. fal is a second independent witness
that the pixels agree - the one claim the DOM evidence cannot make.

## 8 — a control that only exists in one state is not a capability

A compile run while the target happened to be empty minted `createProject` with
the control `"Add a brand new project"` - Vikunja's empty-collection call to
action, on screen only until the first project exists. The tool certified itself
at compile time and could never be replayed afterwards.

`explore.js` was collapsing `aria-label || innerText` into one label, and one page
mixes three conventions: a project card is aria-labelled with empty innerText,
`NEW PROJECT` is innerText with no aria-label, and the bucket picker reads
`To-Do` but is labelled `Kanban bucket: To-Do`. Every handle is recorded now, and
the bucket picker carries `["Kanban bucket: Doing", "Doing"]`.

But recording two handles cannot save a control whose *only* handle is
state-dependent. So `discoverOn` reloads the seed after the action and checks the
control still resolves. It immediately caught one nobody had reported:
`"Create a task."` disappears once the task exists. `createTask` now compiles from
the inline quick-add, whose recipe needs no opener at all.

Tested rather than argued about - a fresh project is an empty collection with its
own empty state, so no shared data was touched:

```
while empty   ... | Create a task.     <- the CTA
captured      control "Add a task", stable -> KEPT, created /tasks/177
after a task  ... | Add to Favorites   <- the CTA is gone
```

The rule finally settled where `replay.js` already had it: **a dead control only
matters when the fields it was meant to reveal are unreachable without it.**
`createProject`'s fields sit behind a modal, so losing its opener loses the tool.
A quick-add box is on the page whatever the collection holds, so a stale CTA costs
nothing. Capture-time and replay-time now make the same judgement.

## 9 — a probe that fails proves nothing either way

The stability check had a failure mode worse than the bug it fixed. It collapsed
three different "could not tell" cases into "does not resolve", and "does not
resolve" rejects: a `goto` that threw, a locator that threw, and a session that
expired mid-compile all fell through to the same `false`. Vikunja bounces an
expired session to `/login`, where `NEW PROJECT` legitimately does not exist.

The rejection was not local. Every deeper seed hangs off the project URL, so
dropping create-project took `createTask`, `moveTask`, `updateTask`, `markTask`,
`assignLabel` and `deleteTask` with it. **One expired session, seven lost tools,
exit code 0.** A compile returning 2 tools looked exactly like a compile that
never found 9.

`persist.js` had already written the rule down: *"A probe that fails proves
nothing either way. Never reject a tool on the strength of a page that would not
load."* The check is tri-state now and only an explicit `false` rejects. And the
cascade is gone regardless - tasks live in **any** project, not only one apic just
made, so discovery falls back to an existing one.

## 10 — the noun list was a constant in a source file

`plan.js` decides what a control means by matching it against a table of board
resources. Those were Vikunja's words, hand-written. Point apic at Gitea and the
same table is asked about issues and repositories and has never heard of them.

Tavily finds the target's documentation, OpenAI structures the prose into a closed
vocabulary under a strict schema, and the result is cached per host so a demo does
not depend on venue wifi. Additive only: built-ins always match first, so grounding
can add vocabulary but never take Vikunja's away.

For Vikunja it derives `project, task, label, bucket` - exactly the hardcoded
table, which is good validation and no gain. The gain shows on the next target:
ParaBank's nouns are `account` and `loan`, and the built-in table returns `null`
for both. Ungrounded, every one of those controls is dropped.

## 11 — Pioneer was answering an empty question

The key returned `403 payment_method_required`, which a card fixed. Underneath it
was a second failure that no amount of credit would have surfaced.

`PERCEPTION_SCHEMA` sent `multi_label: false, top_k: 1`. Both are accepted by
`/inference` and both silently change the response: with them the call returns
`200` and `categories: []` for every input, which reads downstream as *"the
classifier had no opinion"* and falls through to the node count. Without them the
same request returns `{state_change: {label, confidence}}` - the shape
`pickLabel()` already parsed. Measured on one trajectory: **0/13 classified, then
7-13.**

The remainder come back `state_change: null`, and that is the provider. Four
identical requests returned 12/13, 7/13, 7/13, 7/13. Those nulls escalate to the
heuristic and then to fal, which is the ladder working rather than failing.

---

# The stack, as of the final compile

| stage | tech | what it actually does | without it |
|---|---|---|---|
| `explore` | **h** | picks the next control to try, goal-directed | heuristic verb ranking |
| `ground` | **Tavily** + OpenAI | derives the app's nouns from its own docs | the built-in table |
| `distill` | **Pioneer** | GLiNER2 classifies the whole trajectory in one call | node counting |
| `perceive` | **fal** | judges the steps text could not settle | the DOM differ |
| `verify` | **OpenAI** | replays each tool cold and rules on the effect | a deterministic diff judge |

Five, all load-bearing. This morning three were declared and two of those were
never called: `@fal-ai/client` was a dependency with no caller, and `ground` was a
stage name in `config.js` with no file behind it.

Every one still degrades. Playwright drives the browser and the DOM differ decides
what changed; both are keyless and deterministic. apic compiles with no
credentials at all - that is the bottom rung, and it never stopped working.

---

## Where the remaining 10 are

| missed | why |
|---|---|
| `PUT/DELETE /tasks/{taskID}/assignees` | assignee is a person, not a board resource — deliberately off-slice |
| `PUT/POST/DELETE /tasks/{taskID}/comments` | comments are off-slice for the same reason |
| `DELETE /labels/{id}`, `DELETE /projects/{id}` | reachable, but destructive probes are limited to rows apic created itself |
| `POST /projects/{id}` | project rename — same contenteditable pattern as task rename, not yet seeded |
| `POST /tasks/{id}/position` | within-column reordering; the drag lands in a column, not at an index |
| `DELETE /tasks/{task}/labels/{label}` | needs a label already attached, then removed |

Recall is capped at 17 in principle, not 18: `markTask` and `updateTask` are
both genuinely `POST /tasks/{id}`, and the scorer lets one tool claim one op.
