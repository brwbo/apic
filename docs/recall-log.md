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
