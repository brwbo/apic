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
| **h** | `explore` | **MCP: https://hub.hcompany.ai/mcp** - prefer the MCP endpoint over a bespoke HTTP integration |
| **fal** | `perceive` | Fast VLM for meaningful-vs-cosmetic change judgement |
| **OpenAI** | `synthesize`, `verify` | Schema synthesis, precondition inference, verification |
| **Tavily** | `ground` | Docs -> domain vocabulary for tool names/descriptions |
| **Pioneer** | `distill` | Small model distilled from fal's labels. Side challenge |

**VEED is NOT a partner technology** - it is not on the Resources list.

## Build rules

- Keep files under 500 lines
- Validate input at boundaries (see `src/config.js` `requireStage`)
- Every stage must degrade: the Playwright driver and DOM differ run with no
  keys at all. That is fallback ladder rung 3 and it must keep working.
