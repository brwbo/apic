import { useEffect, useRef } from "react";
import { useInView } from "motion/react";
import NumberTicker, { type NumberTickerRef } from "@/components/ui/basic-number-ticker";
import { SectionLabel } from "@/components/section-label";

/**
 * Measured on Vikunja, 22 August 2026. Nothing here is aspirational.
 *
 * The repair figure is the watcher's own counter (out/watch-stats.json), not a
 * demo stopwatch: three repairs at 20.8s, 21.2s and 18.3s. It used to read 15s,
 * which no run ever produced.
 */
const STATS = [
  { value: 9, suffix: "", label: "tools compiled", sub: "from the UI, never the API" },
  { value: 8, suffix: "", label: "real write actions found", sub: "scored against Vikunja's own OpenAPI spec" },
  { value: 100, suffix: "%", label: "precision", sub: "every emitted tool maps to a real endpoint" },
  { value: 20, suffix: "s", label: "mean time to repair", sub: "3 unattended repairs, measured by the watcher over a live afternoon" },
];

function Stat({ s, i }: { s: (typeof STATS)[number]; i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const ticker = useRef<NumberTickerRef>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });

  useEffect(() => { if (inView) ticker.current?.startAnimation() }, [inView]);

  return (
    <div ref={ref} className="sm:border-l sm:border-white/10 sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
      <div className="font-extrabold tabular-nums tracking-[-0.05em] text-white" style={{ fontSize: "clamp(2.6rem, 5.4vw, 4rem)", fontFamily: "var(--font-display)" }}>
        <NumberTicker
          ref={ticker}
          from={0}
          target={s.value}
          autoStart={false}
          transition={{ duration: 1.6, ease: "easeOut", type: "tween", delay: i * 0.08 }}
        />
        {s.suffix}
      </div>
      <p className="mt-2 text-[13px] font-medium text-white/75">{s.label}</p>
      <p className="mt-1 text-[12px] leading-snug text-white/35">{s.sub}</p>
    </div>
  );
}

export function Stats() {
  return (
    <section className="border-t border-white/10 bg-[#120a10] px-6 py-20 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Measured, not claimed</SectionLabel>
        <div className="mt-9 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => <Stat key={s.label} s={s} i={i} />)}
        </div>
      </div>
    </section>
  );
}

export default Stats;
