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
    role: "Looks at the buttons and forms apic could not make sense of on its own, and says which of them actually change something.",
    detail: "holo3-1-35b-a3b · OpenAI-compatible inference endpoint · one JPEG of the page per seed",
    note: "An escalation tier, not the planner. gesture() maps a control's visible text to a <verb, resource> pair and returns null for everything else — that null is the precision gate, and it is also where recall goes: an icon-only button is dropped however plainly it writes. h is handed exactly that set, once per seed, and every answer is validated back against the same six verbs and four resources, so it can recover a control but never invent a verb. Measured on this target: 3 unresolved controls read, 1 named — a Kanban bucket control with no text, recovered from its icon.",
    without: "Any control the built-in noun tables cannot place is dropped, and nothing looks at it a second time.",
  },
  {
    name: "fal",
    src: "/logos/fal.svg",
    stage: "perceive",
    role: "Compares before-and-after screenshots and says whether something actually happened, or the page just redrew itself.",
    detail: "fal-ai/any-llm/vision · gemini-2.5-flash-lite · 1440×900 frame inline as a data URI",
    note: "It is an escalation tier, not a default. Steps the app already confirmed with its own success banner never reach it, so the VLM is spent only on the cases DOM text genuinely cannot settle. It runs on the CLI compile; a compile driven through compile_app on the MCP server stays on the text tier.",
    without: "The text classification stands, and a re-render can pass as a write.",
  },
  {
    name: "OpenAI",
    stage: "ground · verify (standby)",
    src: "/logos/openai_dark.svg",
    role: "Reads the documentation Tavily found and pulls out the words the app uses for its things — issue, repository, task — so the tools get sensible names. Also the backup judge, behind Pioneer, for whether a replayed tool really worked.",
    detail: "gpt-4.1-mini · strict JSON schema, structured output",
    note: "Not synthesise — that stage takes verb and noun off the label and JSON Schema off the fields, with no model in it at all. In verify OpenAI sits on top of the keyless diff judge and may tighten a verdict but never loosen one. It has been caught citing a filter box's own echo as independent evidence — a judge looser than the free check is worse than no judge.",
    without: "The built-in noun table stands; if the Pioneer judge is also absent, deterministic diff judging alone.",
  },
  {
    name: "Tavily",
    src: "/logos/tavily.svg",
    stage: "ground",
    role: "Goes and finds the app's own documentation on the web. apic was written knowing Vikunja's words — task, project, label. Point it at Gitea and Tavily is how it learns that this app has issues, repositories and pull requests instead.",
    detail: "api.tavily.com/search · prose to a closed noun set, capped at 12, cached per host",
    note: "The built-in tables are Vikunja's words — bucket, task, label, project. Point apic at Gitea and issue, repository and pull request are terms it has never heard of. Grounding only ever adds vocabulary; it cannot remove what is already there.",
    without: "apic only knows the words it was born with. Anything an app calls something else gets a worse name, or gets dropped.",
  },
  {
    name: "Pioneer",
    src: "/logos/pioneer.svg",
    stage: "verify · distill",
    role: "A small model we trained on apic's own results. After a tool is replayed, it reads what changed on the page and decides whether the action really worked — faster than GPT-4.1-mini, and with no wrong \"yes\" answers on tools it had never seen.",
    detail: "fastino/gliner2-base-v1 · LoRA, 788 rows, trains in ~4 min · held-out bench: 94.4% accuracy, 100% precision, 150 ms/row — against 89.3%, 84.3%, 890 ms for gpt-4.1-mini",
    note: "No hand labels. Every compiled tool is replayed six times and the shipped judge's verdict is recorded; negatives are made by deleting the evidence the deterministic floor keys on, and relabelled by that floor. The bench holds out whole tools, so the number is generalisation, not memory. The encoder trades some recall for zero false positives — the right side for a judge that may uphold a rejection but never promote a guess. In distill the same base model classifies what kind of change a step was.",
    without: "The OpenAI judge, then the keyless diff floor. Verify never stops working; it gets slower and looser.",
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
          apic is mostly ordinary code. At five points it needs a judgement call — what to click,
          did that work, what is this thing called — and each of those is handed to exactly one
          model. Take any of them away and apic still runs, just a bit blinder. The plain-English
          job comes first; the exact call underneath it is there so the claim can be checked.
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
