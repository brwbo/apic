import { SectionLabel } from "@/components/section-label";
const COLUMNS = [
  {
    kind: "An afternoon",
    when: "when the source has an API",
    tone: "ok",
    lines: ["Read the docs", "Write the client", "Ship it", "Forget it exists for years"],
  },
  {
    kind: "Never finished",
    when: "when the source is just a page",
    tone: "bad",
    lines: [
      "Write a scraper against markup you do not own",
      "It breaks the week somebody renames a class",
      "So a person copies the rows out by hand",
      "Every Monday, indefinitely",
    ],
  },
];

export function Problem() {
  return (
    <section id="problem" className="border-t border-white/10 bg-[#120a10] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>The problem</SectionLabel>
        <h2 className="mt-5 max-w-3xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          The data was public. There was just no way in.
        </h2>

        <div className="mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-white/65">
          <p>
            Before this I built a lead finder for an IT consultancy &mdash; it scans UK public
            procurement feeds and writes qualified leads into their CRM. The sources with an API took an
            afternoon each. The ones without have never really been finished.
          </p>
          <p>
            Not because anything was hidden. Because a portal that renders a table for a human, and
            offers nothing else, is a wall to everything that isn&rsquo;t one. That is most business
            software: internal tools, council portals, supplier directories, the system a vendor stopped
            maintaining in 2014.
          </p>
          <p>
            Computer-use agents can read those screens. But they re-read them, from pixels, on every
            single run &mdash; so the cost never amortises and reliability compounds downward over a
            chain of steps. Which is why they get demoed constantly and deployed rarely.
          </p>
          <p className="text-white/80">
            apic is the third option: send the agent in once, and keep what it learned as a typed API.
          </p>
        </div>

        {/* The actual target, screenshotted from the running app - not a mockup. */}
        <figure className="mt-12 overflow-hidden rounded-xl border border-white/12 bg-black/40">
          <img
            src="/target-board.png"
            alt="The Vikunja board apic compiles: four columns of task cards."
            width={1440}
            height={900}
            loading="lazy"
            decoding="async"
            className="block w-full"
          />
          <figcaption className="border-t border-white/10 px-4 py-2.5 font-mono text-[12px] text-white/35">
            The target · a Kanban board · no API an agent can call
          </figcaption>
        </figure>

        <div className="mt-12 grid gap-x-14 gap-y-10 sm:grid-cols-2">
          {COLUMNS.map((col, i) => (
            <div key={col.kind} className={i === 1 ? "sm:border-l sm:border-white/10 sm:pl-14" : ""}>
              <p
                className={`font-[family-name:var(--font-display)] text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-none tracking-[-0.035em] ${i === 1 ? "text-primary" : "text-white/85"}`}
              >
                {col.kind}
              </p>
              <p className="mt-2 text-[14px] text-white/40">{col.when}</p>
              <ul className="mt-6 space-y-3">
                {col.lines.map((line, j) => (
                  <li key={line} className="flex gap-4 text-[15px] leading-snug text-white/55">
                    <span className="w-4 shrink-0 font-mono text-[12px] text-white/20">{j + 1}</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default Problem;
