import { SectionLabel } from "@/components/section-label";

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

        {/* Per-call comparison */}
        <div className="mt-12 overflow-x-auto rounded-xl border border-white/12 bg-black/40">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 font-mono text-[12px] text-white/35">
                <th className="px-4 py-3 font-normal">per call</th>
                <th className="px-4 py-3 font-normal">interpreted · Playwright MCP, computer use</th>
                <th className="px-4 py-3 font-normal text-primary/85">compiled · apic</th>
              </tr>
            </thead>
            <tbody>
              {PER_CALL.map((r) => (
                <tr key={r.label} className="border-b border-white/[0.06] last:border-b-0">
                  <td className="px-4 py-3 text-white/50">{r.label}</td>
                  <td className="px-4 py-3 text-white/55">{r.interp}</td>
                  <td className="px-4 py-3 text-white/85">{r.compiled}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
