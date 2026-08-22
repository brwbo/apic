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
    note: "apic first tries to read every control from its label alone — \"New project\" is obviously a create. Anything with no usable label, like an icon-only button, is what h gets: a screenshot of the page and the list of leftovers, once per page. Its answers are checked against the same short list of verbs and nouns apic already uses, so it can rescue a button but never make up a new kind of action. On Vikunja it was shown 3 leftovers and correctly named 1 — an icon-only Kanban column control.",
    without: "Any button apic cannot read from its label is simply skipped.",
  },
  {
    name: "fal",
    src: "/logos/fal.svg",
    stage: "perceive",
    role: "Compares before-and-after screenshots and says whether something actually happened, or the page just redrew itself.",
    detail: "fal-ai/any-llm/vision · gemini-2.5-flash-lite · 1440×900 frame inline as a data URI",
    note: "Only called when the text on the page cannot settle it. If the app showed a \"Project created\" banner, that is the answer and no screenshot is sent. The pictures are spent on the ambiguous cases — a card that moved column, a row that reordered — where nothing was announced.",
    without: "apic goes on what the page text says, and a page that merely redrew can be mistaken for one that changed.",
  },
  {
    name: "OpenAI",
    stage: "ground · verify (standby)",
    src: "/logos/openai_dark.svg",
    role: "Reads the documentation Tavily found and pulls out the words the app uses for its things — issue, repository, task — so the tools get sensible names. Also the backup judge, behind Pioneer, for whether a replayed tool really worked.",
    detail: "gpt-4.1-mini · strict JSON schema, structured output",
    note: "It does not write the tools — that part is plain code, no model involved. As a judge it is allowed to say \"no\" to a tool the basic check passed, but never \"yes\" to one it failed. That rule exists because it was once caught calling a search box redisplaying what was typed into it proof that something was saved.",
    without: "Tools keep the names apic already knows, and the basic page-diff check is the only judge.",
  },
  {
    name: "Tavily",
    src: "/logos/tavily.svg",
    stage: "ground",
    role: "Goes and finds the app's own documentation on the web. apic was written knowing Vikunja's words — task, project, label. Point it at Gitea and Tavily is how it learns that this app has issues, repositories and pull requests instead.",
    detail: "api.tavily.com/search · prose to a closed noun set, capped at 12, cached per host",
    note: "Tavily searches the web for the app's docs and returns the pages; OpenAI then reads them and picks out up to twelve nouns. New words are added to what apic knows, never swapped in for it, and the result is saved per app so a second compile costs nothing.",
    without: "apic only knows the words it was born with. Anything an app calls something else gets a worse name, or gets dropped.",
  },
  {
    name: "Pioneer",
    src: "/logos/pioneer.svg",
    stage: "verify · distill",
    role: "A small model we trained on apic's own results. After a tool is replayed, it reads what changed on the page and decides whether the action really worked — faster than GPT-4.1-mini, and with no wrong \"yes\" answers on tools it had never seen.",
    detail: "fastino/gliner2-base-v1 · LoRA, 788 rows, trains in ~4 min · held-out bench: 94.4% accuracy, 100% precision, 150 ms/row — against 89.3%, 84.3%, 890 ms for gpt-4.1-mini",
    note: "Nobody labelled anything by hand. apic replayed each of its own tools six times and wrote down what the page did and what its existing judge decided. From those we made harder examples — the same page with the success message deleted, or the typed value only showing in the box it was typed into — and trained on the lot. The test set holds back two whole tools the model never saw, so the score is about new tools, not remembered ones. It says \"yes\" a little less often than GPT, and was never wrong when it did.",
    without: "OpenAI judges instead — slower, and more willing to pass a tool that did not really work. With no keys at all, the basic page-diff check still runs.",
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
          Remove all five keys and apic still compiles — the browser driver and the page-diff check
          need nothing configured. What the keys buy is the difference between a guess and a
          measurement at each step.
        </p>
      </div>
    </section>
  );
}

export default Partners;
