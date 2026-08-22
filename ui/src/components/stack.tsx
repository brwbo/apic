/**
 * stack.tsx - what each partner technology actually does.
 *
 * Every entry here is checked against the source, not against the pitch. A tech
 * earns a row by being called at runtime; `where` names the file so the claim is
 * falsifiable in one click. `fallback` is the point of the section: each stage
 * degrades to something keyless, so a dead API at the venue costs quality, not
 * the demo - and that is also the honest answer to "is it load-bearing?".
 */

interface Stage {
  stage: string;
  name: string;
  /** Model or endpoint, so nobody has to guess which tier is running. */
  model: string;
  /** Source file that makes the call. */
  where: string;
  does: string;
  fallback: string;
}

const STACK: Stage[] = [
  {
    stage: "explore",
    name: "h",
    model: "holo3-1-35b-a3b · api.hcompany.ai/v1",
    where: "src/h.js",
    does:
      "Picks the next control to try. Given the page, the goal and everything already attempted, Holo chooses which affordance is most likely to reveal a write — so exploration is goal-directed instead of exhaustive.",
    fallback:
      "A keyless heuristic ranker that scores labels by verb: create first, destructive last.",
  },
  {
    stage: "distill",
    name: "Pioneer",
    model: "GLiNER2 ~300M · one batched POST /inference",
    where: "src/distill.js",
    does:
      "Reads the DOM diff text for the whole trajectory in a single call, classifies each step as a real state change or not, flags the destructive ones, and pulls out the domain nouns that name the tool.",
    fallback:
      "Node counting — more nodes after than before means creation. Cheap, and wrong more often.",
  },
  {
    stage: "verify",
    name: "OpenAI",
    model: "gpt-4.1-mini · structured output",
    where: "src/verify.js",
    does:
      "A synthesised tool is a claim; executing it is the proof. Each compiled tool is replayed cold with arguments the app has never seen, and asked whether the predicted effect is the effect that happened. Only survivors reach the emitted server.",
    fallback:
      "A deterministic diff judge that compares the observed effect to the recorded one.",
  },
];

export function Stack() {
  return (
    <section id="stack" className="border-t border-white/10 bg-[#0a0511] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-primary/80">The stack</p>
        <h2 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl">
          Three models, three jobs, three fallbacks.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          Each stage calls a model for judgement and keeps a keyless path underneath it. Pull any
          key and the compile still finishes — it just gets worse. That is deliberate: a demo that
          dies because someone&rsquo;s API is down is not a demo.
        </p>

        <ol className="mt-12 space-y-px">
          {STACK.map((s, i) => (
            <li
              key={s.stage}
              className="grid gap-x-8 gap-y-3 border-t border-white/10 py-8 sm:grid-cols-[160px_1fr]"
            >
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">
                  {String(i + 1).padStart(2, "0")} · {s.stage}
                </p>
                <p className="mt-2 text-xl font-bold tracking-[-0.02em] text-white">{s.name}</p>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-primary/70">{s.model}</p>
              </div>

              <div>
                <p className="text-[15px] leading-relaxed text-white/65">{s.does}</p>
                <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-relaxed text-white/35">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
                    without it
                  </span>
                  {s.fallback}
                </p>
                <p className="mt-3 font-mono text-[10px] tracking-[0.06em] text-white/25">{s.where}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-10 max-w-2xl border-t border-white/10 pt-6 text-[13px] leading-relaxed text-white/40">
          Playwright drives the browser and the DOM differ decides what changed. Both are keyless,
          both are deterministic, and together they are the bottom rung — apic compiles with no
          credentials at all.
        </p>
      </div>
    </section>
  );
}

export default Stack;
