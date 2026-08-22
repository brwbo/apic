import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";

/**
 * Interpreter vs compiler, mapped onto agents. An interpreter re-derives what
 * to do every run; a compiler does the thinking once and writes it down.
 */
const PER_CALL = [
  { label: "Model round-trips", interp: "one per step", compiled: "none" },
  { label: "Context consumed", interp: "a page snapshot per step", compiled: "the arguments" },
  { label: "Knows which button is which", interp: "re-derived from pixels", compiled: "decided once, at build" },
  { label: "Reliability over a 5-step chain", interp: "0.95⁵ ≈ 77%", compiled: "the script works or the suite goes red" },
  { label: "What the caller needs to know", interp: "the UI", compiled: "a typed signature" },
  { label: "When the UI changes", interp: "improvises, sometimes wrongly", compiled: "re-discovers and rebuilds" },
  { label: "Inside Claude Code or Cursor", interp: "the coding agent does the clicking, in its own context", compiled: "a few typed tools; it never sees the UI" },
];

const WINS = [
  {
    head: "The model leaves the hot path",
    body: "A compiled tool runs with zero tokens. For an action taken all day, that is orders of magnitude, not a percentage.",
  },
  {
    head: "Failure stops compounding",
    body: "A chain of interpreted steps fails multiplicatively. A verified script either works or is flagged, and a red tool re-enters discovery on its own.",
  },
  {
    head: "Another agent can plan against it",
    body: "createProject(name, description) with a schema is something a planner can call. “Drive this UI” is not.",
  },
  {
    head: "It only ships what the app confirmed",
    body: "A tool is emitted when the app itself says state changed - a banner, a URL carrying the value, a rendered row. Never from counting buttons.",
  },
  {
    head: "Repair is rebuild, not patching",
    body: "Healing re-runs the discovery that found the tool and matches by the name synthesis produces. A renamed button still yields createProject.",
  },
  {
    head: "It fits inside a coding agent",
    body: "Both are MCP servers, but Playwright MCP makes Claude Code the interpreter - it spends its context on snapshots and its turns on clicks. apic hands it createProject and gets out of the way.",
  },
];

const NOT_WHEN = [
  "You will do the action once. Compiling is pure overhead; use the agent directly.",
  "The UI changes faster than your watch interval. You would just be recompiling.",
  "You need a contract. A compiled tool is empirically correct - it has worked N times - not correct by construction.",
];

export function Compile() {
  return (
    <section id="compile" className="border-t border-white/10 bg-[#0a0509] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Compile, don&rsquo;t interpret</SectionLabel>
        <h2 className="mt-5 max-w-3xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          Move the model from the hot path to the build step.
        </h2>

        <div className="mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-white/65">
          <p>
            An interpreter works out what to do every time the program runs. A compiler works it out
            once and writes the answer down. Same result; the expensive thinking just happens at a
            different time.
          </p>
          <p>
            A computer-use agent is an interpreter for a web app - Playwright MCP, Browser Use,
            OpenAI Operator, Claude&rsquo;s computer use. Every call, it screenshots, reasons about
            which button is which, clicks, and reasons again. apic does that reasoning once, and what
            comes out is a fixed, typed tool backed by a deterministic script, for your coding agent.
          </p>
        </div>

        {/* Per-call comparison.

            Not a bordered box with three equal columns: the compiled column is
            the argument, so it gets a slab of its own that runs the full height
            of the table, and the other two sit outside it on the page ground.
            Pattern lifted from 21st.dev's comparison-3 (7ovr) - highlighted
            column, hairline row rules, no outer frame - recoloured to the
            site's sand primary. Below `sm` a 3-column table is unreadable, so
            each row becomes its own card instead of a sideways scroll. */}
        <div className="mt-12">
          <div className="hidden overflow-x-auto pb-1 sm:block">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[14px]">
              <thead>
                <tr>
                  <th className="w-[30%] px-1 pb-4 align-bottom font-mono text-[11px] font-normal uppercase tracking-[0.18em] text-white/30">
                    per call
                  </th>
                  <th className="w-[38%] px-5 pb-4 align-bottom font-normal">
                    <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-white/30">
                      interpreted
                    </span>
                    <span className="mt-1.5 block text-[13px] text-white/45">Playwright MCP, computer use</span>
                  </th>
                  <th className="rounded-t-xl border-x border-t-2 border-x-primary/25 border-t-primary/60 bg-primary/[0.09] px-5 pb-4 pt-4 align-bottom font-normal">
                    <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-primary/85">
                      compiled
                    </span>
                    <span className="mt-1.5 block text-[13px] text-white/70">apic</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {PER_CALL.map((r, i) => {
                  const last = i === PER_CALL.length - 1;
                  return (
                    <tr key={r.label} className="group">
                      <td className="border-t border-white/[0.07] px-1 py-4 align-top leading-relaxed text-white/45 transition-colors group-hover:text-white/70">
                        {r.label}
                      </td>
                      <td className="border-t border-white/[0.07] px-5 py-4 align-top leading-relaxed text-white/50">
                        {r.interp}
                      </td>
                      <td
                        className={cn(
                          "border-x border-t border-x-primary/25 border-t-primary/15 bg-primary/[0.09] px-5 py-4 align-top font-medium leading-relaxed text-white/90",
                          last && "rounded-b-xl border-b border-b-primary/25",
                        )}
                      >
                        {r.compiled}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 sm:hidden">
            {PER_CALL.map((r) => (
              <div key={r.label} className="rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-[13px] leading-relaxed text-white/45">{r.label}</p>
                <div className="mt-3 space-y-2.5">
                  <div className="flex gap-3">
                    <span className="w-[72px] shrink-0 pt-[3px] font-mono text-[9px] uppercase tracking-[0.1em] text-white/25">
                      interpreted
                    </span>
                    <span className="text-[14px] leading-relaxed text-white/55">{r.interp}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-[72px] shrink-0 pt-[3px] font-mono text-[9px] uppercase tracking-[0.1em] text-primary/75">
                      apic
                    </span>
                    <span className="text-[14px] font-medium leading-relaxed text-white/90">{r.compiled}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Why that matters */}
        <div className="mt-14 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {WINS.map((w, i) => (
            <div key={w.head} className="flex gap-4">
              <span className="w-4 shrink-0 pt-1 font-mono text-[12px] text-white/20">{i + 1}</span>
              <div>
                <p className="text-[15px] font-semibold text-white/85">{w.head}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-white/55">{w.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* The honest part */}
        <div className="mt-14 max-w-2xl border-l border-white/10 pl-6">
          <p className="font-mono text-[13px] text-white/40">When it is not better</p>
          <ul className="mt-4 space-y-3">
            {NOT_WHEN.map((line) => (
              <li key={line} className="text-[14px] leading-relaxed text-white/55">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14px] leading-relaxed text-white/70">
            apic wins whenever the same action will be taken more than a handful of times against
            software that cannot give you an API. That is most of the software agents are asked to drive
            - and it means your agent stops hitting walls just because a site has no API.
          </p>
        </div>
      </div>
    </section>
  );
}

export default Compile;
