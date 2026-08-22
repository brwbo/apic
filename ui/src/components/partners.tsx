import { SectionLabel } from "@/components/section-label";

/**
 * stack.tsx already shows the five marks with a one-word stage each. That row
 * says who is in the pipeline; it does not say what any of them is doing, and
 * "used OpenAI" is not a claim anyone should have to take on trust. This is the
 * long form: the call each one makes, and what the compiler loses without it.
 *
 * Every line here is checked against the source rather than written from the
 * pitch - model ids, endpoints and fallbacks all come from src/.
 */
type Partner = {
  name: string;
  stage: string;
  src: string;
  /** What it decides. One sentence, in terms of the pipeline. */
  role: string;
  /** The concrete call, so the claim is falsifiable. */
  detail: string;
  /** The design note worth knowing - usually why this call and not the obvious one. */
  note?: string;
  /** What the compiler falls back to. Each stage degrades; none degrades for free. */
  without: string;
};

const PARTNERS: Partner[] = [
  {
    name: "h",
    src: "/logos/h.svg",
    stage: "explore",
    role: "Chooses the next action to try from the affordances on the page.",
    detail: "holo3-1-35b-a3b · OpenAI-compatible inference endpoint",
    note: "The hosted Agent Platform runs the browser on h's own infrastructure, with no bring-your-own CDP endpoint, so it cannot reach a Vikunja on localhost. apic keeps its local browser and puts Holo where the decision actually is.",
    without: "Labels are ranked heuristically, and any control the built-in noun tables cannot place is dropped.",
  },
  {
    name: "fal",
    src: "/logos/fal.svg",
    stage: "perceive",
    role: "Settles whether a change was a real write or a cosmetic re-render.",
    detail: "fal-ai/any-llm/vision · gemini-2.5-flash-lite · 1440×900 frame inline as a data URI",
    note: "It is an escalation tier, not a default. Steps the app already confirmed with its own success banner never reach it, so the VLM is spent only on the cases DOM text genuinely cannot settle.",
    without: "The text classification stands, and a re-render can pass as a write.",
  },
  {
    name: "OpenAI",
    stage: "synthesise · verify",
    src: "/logos/openai_dark.svg",
    role: "Turns a discovered action into a typed tool, then rules on whether the replayed tool did what it claims.",
    detail: "gpt-4.1-mini · strict JSON schema, structured output",
    note: "In verify it sits on top of the keyless diff judge, and may tighten a verdict but never loosen one. It has been caught citing a filter box's own echo as independent evidence — a judge looser than the free check is worse than no judge.",
    without: "Heuristic verb-plus-noun naming, and deterministic diff judging alone.",
  },
  {
    name: "Tavily",
    src: "/logos/tavily.svg",
    stage: "ground",
    role: "Reads the target app's own documentation so the compiler learns that app's nouns.",
    detail: "api.tavily.com/search · prose to a closed noun set, capped at 12, cached per host",
    note: "The built-in tables are Vikunja's words — bucket, task, label, project. Point apic at Gitea and issue, repository and pull request are terms it has never heard of. Grounding only ever adds vocabulary; it cannot remove what is already there.",
    without: "The built-in table stands and the compile runs exactly as before.",
  },
  {
    name: "Pioneer",
    src: "/logos/pioneer.svg",
    stage: "distill",
    role: "Classifies what kind of change happened, replacing the softest inference in the compiler.",
    detail: "GLiNER2, a ~300M encoder · one forward pass for classification and NER · $0.15/M tokens",
    note: "POST /inference over /gliner-2 despite the lower rate limit, because it returns the inference_id that feedback needs. The same slot accepts a fine-tuned training-job id, so base model to LoRA checkpoint is one environment variable.",
    without: "Counting DOM nodes and guessing from the delta.",
  },
];

/**
 * Sized by height with the width left to the artwork, because these are not all
 * square: h's mark is a circle beside an H at 30x18, while fal, Tavily and
 * Pioneer are square glyphs. Forcing a box would squash one to fit the others.
 *
 * Each file is the vendor's own mark with its fill set to #fff, matching the
 * openai_dark.svg already in public/logos. They ship near-black (#040405 for h,
 * #1F1E1E for Tavily) which is invisible on this background, and currentColor
 * is no use because an SVG loaded through <img> cannot inherit the page's colour.
 */
function Mark({ p }: { p: Partner }) {
  return <img src={p.src} alt="" className="h-[22px] w-auto shrink-0 opacity-90" aria-hidden />;
}

export function Partners() {
  return (
    <section id="partners" className="border-t border-white/10 bg-[#0a0509] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Partner technology</SectionLabel>
        <h2 className="mt-5 max-w-2xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          Five models, one decision each.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          Each stage of the compiler hands exactly one judgement to a model and keeps the rest
          deterministic. Every one of them degrades to a working fallback — which is the point:
          you can see precisely what each is buying.
        </p>

        <ul className="mt-14">
          {PARTNERS.map((p) => (
            <li
              key={p.name}
              className="grid gap-x-12 gap-y-5 border-t border-white/10 py-9 sm:grid-cols-[180px_1fr]"
            >
              <div className="flex items-center gap-2.5 sm:block">
                <Mark p={p} />
                <div className="sm:mt-3">
                  <p className="text-[17px] font-medium leading-none text-white/90">{p.name}</p>
                  <p className="mt-1.5 font-mono text-[12px] text-primary/80">{p.stage}</p>
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-[16px] leading-relaxed text-white/85">{p.role}</p>
                <p className="mt-3 font-mono text-[12px] leading-relaxed text-white/40">{p.detail}</p>
                {p.note && (
                  <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-white/55">{p.note}</p>
                )}
                <p className="mt-4 text-[13px] leading-relaxed text-white/35">
                  <span className="text-white/45">Without it — </span>
                  {p.without}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-12 max-w-2xl border-t border-white/10 pt-8 text-[14px] leading-relaxed text-white/45">
          Strip all five keys and apic still compiles: the Playwright driver and the DOM differ run
          with nothing configured at all. What the keys buy is the difference between a guess and a
          measurement at every stage.
        </p>
      </div>
    </section>
  );
}

export default Partners;
