# apic - project rules

## Secrets - non-negotiable

- **NEVER** commit, print, echo, log or paste API keys anywhere. Not in code,
  commits, README, issues, the Loom, or terminal output that gets screenshotted.
- Keys live in `~/.config/apic/env` (mode 600). The repo's `.env` is a **symlink**
  to it and is gitignored. Never write a real key into `.env.example`.
- **This repo is PUBLIC.** GitHub secret scanning auto-revokes committed OpenAI
  keys, which breaks the build rather than protecting it.
- Never `git add -A`. Add explicit paths.
- Before any commit that touches config: `git diff --cached | grep -iE "sk-|api[_-]?key|token"`

## Partner technologies - prioritise these

Judging is creativity + technical complexity, **with bonus points for effective
use of partner technologies**. Minimum 3 required. Use as many as possible, and
make each one load-bearing - a tech that could be removed without breaking the
product scores nothing.

| Tech | Stage | Endpoint / notes |
|---|---|---|
| **h** | `explore` | Models API, OpenAI-compatible. Base `https://api.hcompany.ai/v1/`, `Authorization: Bearer $HAI_API_KEY`. See note below |
| **fal** | `perceive` | Fast VLM for meaningful-vs-cosmetic change judgement |
| **OpenAI** | `synthesize`, `verify` | Schema synthesis, precondition inference, verification |
| **Tavily** | `ground` | Docs -> domain vocabulary for tool names/descriptions |
| **Pioneer** | `distill` | **GLiNER2 encoder (~300M, $0.15/M) over the DOM diff text** - classifies state change + destructive, extracts domain nouns. One batched `POST /inference` per compile. Side challenge |

### h - verified 2026-08-22, correcting an earlier error

**`https://hub.hcompany.ai/mcp` is NOT a computer-use endpoint.** It is H Tech Hub's
**documentation-search** MCP server - `search_h_tech_hub`, `query_docs_filesystem_h_tech_hub`,
`submit_feedback`. It cannot drive a browser. An earlier version of this file told the
`explore` stage to prefer it over "a bespoke HTTP integration"; that instruction was
unimplementable and has been removed. (It *is* genuinely useful for looking up h's own
docs and OpenAPI specs - that is how the facts below were confirmed.)

**The Models API is the right endpoint, and `src/h.js` was already using it correctly.**

| | |
|---|---|
| Base URL | `https://api.hcompany.ai/v1/` |
| Auth | `Authorization: Bearer $HAI_API_KEY` (handled by the OpenAI client) |
| Models | `holo3-1-35b-a3b` (free tier, rate-limited, no credit card), `holo3-122b-a10b` |
| Keys | `https://portal.hcompany.ai/?product=modelsapi` |

🔴 **The key must be a Models API key.** A key minted for another h product returns
`401 Unauthorized` against `/v1/chat/completions` with a valid model ID - identical to
the response for no key at all, so the 401 tells you nothing about which failure it is.
`/v1/models` 401s unconditionally and is useless as a health check; probe
`/v1/chat/completions` instead.

⚠️ `holo1-5-7b-20250915` is not a real model ID. It was the default in `src/h.js` and
`.env.example` until 2026-08-22 and never existed.

**VEED is NOT a partner technology** - it is not on the Resources list.

## Build rules

- Keep files under 500 lines
- Validate input at boundaries (see `src/config.js` `requireStage`)
- Every stage must degrade: the Playwright driver and DOM differ run with no
  keys at all. That is fallback ladder rung 3 and it must keep working.
