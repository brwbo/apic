import { Marquee } from "@/components/ui/marquee";

/**
 * The client logos ride a carousel. The five partner technologies used to sit
 * above them as a static row with a stage label each, but the hero already
 * shows those same five marks under "Built with" - partners.tsx is where the
 * stage-by-stage detail lives, so the row here was pure repetition.
 */
type Item = { name: string; src?: string };

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
      // Height-constrained with width left to the artwork: h's mark is a circle
      // beside an H at 30x18, so a square box would squash it.
      <img
        src={item.src}
        alt=""
        height={size}
        style={{ height: size, width: "auto" }}
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
      <div className="mx-auto max-w-5xl px-0">
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
