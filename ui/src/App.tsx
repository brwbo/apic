import Hero from "@/components/hero";
import Stack from "@/components/stack";
import Problem from "@/components/problem";
import Stats from "@/components/stats";
import Demo from "@/components/demo";
import Partners from "@/components/partners";
import Integrations from "@/components/integrations";
import About from "@/components/about";

/** `?still=1` freezes the hero backdrop for slide exports; `?t=` picks the frame. */
const q = new URLSearchParams(window.location.search);
const still = q.get("still") === "1";
const stillTime = Number(q.get("t") ?? 1.0);

export default function App() {
  return (
    <main className="min-h-dvh bg-[#0a0509]">
      <Hero still={still} stillTime={stillTime} />
      <Stack />
      <Problem />
      <Demo />
      <Stats />
      <Partners />
      <Integrations />
      <About />
      <footer className="border-t border-white/10 px-6 py-10 sm:px-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 font-mono text-[12px] text-white/30">
          <span>github.com/brwbo/apic</span>
          <span>OpenAI · fal · Pioneer · Tavily · h</span>
        </div>
      </footer>
    </main>
  );
}
