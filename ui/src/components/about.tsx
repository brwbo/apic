import { SectionLabel } from "@/components/section-label";
const LINKS = [
  { label: "github.com/brwbo", href: "https://github.com/brwbo" },
];

export function About() {
  return (
    <section id="about" className="border-t border-white/10 bg-[#0a0509] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Who built it</SectionLabel>

        <div className="mt-8 grid gap-10 sm:grid-cols-[220px_1fr] sm:gap-14">
          <div>
            <picture>
              <source srcSet="/ben.webp" type="image/webp" />
              <img
                src="/ben.jpg"
                alt="Ben Rowbotham"
                width={704}
                height={860}
                loading="lazy"
                decoding="async"
                className="block w-full max-w-[220px] rounded-2xl border border-white/12 object-cover"
              />
            </picture>
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
              Ben Rowbotham
            </h2>

            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-white/65">
              <p>
                I&rsquo;m 17, still in sixth form at Leicester Grammar School, and I work part-time
                as an AI engineer at 4C, an IT consultancy.
              </p>
              <p>
                Next year I&rsquo;m hoping to found a company &mdash; and if not that, a job, then a
                degree apprenticeship, then AI at university.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target={l.href.startsWith("http") ? "_blank" : undefined}
                  rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="rounded-full border border-white/12 px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-white/60 transition-colors hover:border-white/30 hover:text-white"
                >
                  {l.label}
                </a>
              ))}
            </div>

            <p className="mt-8 font-mono text-[13px] text-white/30">
              Solo entry · {"{Tech: Europe}"} × VEED · 22 August 2026
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default About;
