import { Marquee } from "@/components/ui/marquee";

/**
 * Client logos ride a carousel; the five partner technologies stay a static
 * row, because each carries a stage label that wants reading rather than
 * scrolling past.
 */
type Item = { name: string; src?: string; stage?: string };

const STACK: Item[] = [
  { name: "h", stage: "explore" },
  { name: "fal", stage: "perceive" },
  { name: "OpenAI", src: "/logos/openai_dark.svg", stage: "synthesise · verify" },
  { name: "Tavily", stage: "ground" },
  { name: "Pioneer", stage: "distill" },
];

const CLIENTS: Item[] = [
  { name: "Claude Code", src: "/logos/claude.svg" },
  { name: "Claude Desktop", src: "/logos/claude.svg" },
  { name: "Codex CLI", src: "/logos/openai_dark.svg" },
  { name: "Cursor", src: "/logos/cursor_dark.svg" },
  { name: "VS Code", src: "/logos/vscode.svg" },
];

function Mark({ item, size = 20 }: { item: Item; size?: number }) {
  if (item.src) {
    return (
      <img
        src={item.src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 opacity-90"
        aria-hidden
      />
    );
  }
  // No open logo exists for this one; a set lettermark beats an invented mark.
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[6px] border border-white/20 font-mono text-white/55"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {item.name[0].toLowerCase()}
    </span>
  );
}

export function Stack() {
  return (
    <section className="bg-[#0a0509] px-6 pb-20 pt-4 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          {STACK.map((s) => (
            <div key={s.name} className="flex items-center gap-2.5">
              <Mark item={s} />
              <span className="text-[15px] font-medium text-white/80">{s.name}</span>
              {s.stage && <span className="text-[13px] text-white/30">{s.stage}</span>}
            </div>
          ))}
        </div>

      </div>

      <div className="mx-auto mt-12 max-w-5xl border-t border-white/10 px-0 pt-8">
        <p className="px-6 text-[15px] text-white/45 sm:px-0">Speaks to any MCP client</p>
      </div>

      <div className="mt-6">
        <Marquee duration={34} pauseOnHover fadeAmount={14}>
          {[...CLIENTS, ...CLIENTS].map((c, i) => (
            <div key={`${c.name}-${i}`} className="mx-7 flex items-center gap-2.5">
              <Mark item={c} size={19} />
              <span className="whitespace-nowrap text-[15px] text-white/60">{c.name}</span>
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

export default Stack;
