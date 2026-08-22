const COLUMNS = [
  {
    kind: "Has an API",
    tone: "ok",
    lines: ["Read the docs", "Write the client", "Done in an afternoon", "Runs unattended for years"],
  },
  {
    kind: "Has only a UI",
    tone: "bad",
    lines: [
      "Write a bespoke scraper",
      "It breaks when a class name changes",
      "Or somebody copies rows by hand",
      "Every Monday, forever",
    ],
  },
];

export function Problem() {
  return (
    <section id="problem" className="border-t border-white/10 bg-[#0a0511] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-primary/80">The problem</p>
        <h2 className="mt-4 max-w-3xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl">
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

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {COLUMNS.map((col) => (
            <div
              key={col.kind}
              className={`rounded-xl border p-6 ${
                col.tone === "ok" ? "border-white/12 bg-white/[0.02]" : "border-primary/25 bg-primary/[0.05]"
              }`}
            >
              <p
                className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                  col.tone === "ok" ? "text-white/45" : "text-primary/90"
                }`}
              >
                {col.kind}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.lines.map((line) => (
                  <li key={line} className="flex gap-3 text-[14px] leading-snug text-white/60">
                    <span className={col.tone === "ok" ? "text-white/25" : "text-primary/50"}>&mdash;</span>
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
