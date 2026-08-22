import { useEffect, useRef } from "react";
import { AsciiSunset } from "@/components/ui/ascii-sunset";
import { HoverTerminal } from "@/components/ui/hover-terminal";
import { cn } from "@/lib/utils";

const STAGES = ["Explore", "Perceive", "Synthesise", "Ground", "Verify", "Emit", "Heal", "Watch"];

/**
 * The five partner technologies, in pipeline order.
 *
 * Deliberately a local copy of stack.tsx's list rather than an import: the two
 * sections answer different questions - the hero says who is involved, the
 * stack row says what each one decides - and coupling them means a change to
 * one silently rewrites the other.
 *
 * White-filled marks on a near-black backdrop, so `openai_dark` is the light
 * artwork rather than the dark one. Height-constrained with width left to the
 * artwork, because h's mark is a circle beside an H at 30x18 and a square box
 * would squash it.
 */
const PARTNERS = [
  { name: "h", src: "/logos/h.svg" },
  { name: "fal", src: "/logos/fal.svg" },
  { name: "OpenAI", src: "/logos/openai_dark.svg" },
  { name: "Tavily", src: "/logos/tavily.svg" },
  { name: "Pioneer", src: "/logos/pioneer.svg" },
];

export interface HeroProps {
  eyebrow?: string;
  wordmark?: string;
  headline?: string;
  sub?: string;
  stages?: string[];
  /** Partner marks under the stage row. Pass [] to hide them (the slide exporter does). */
  partners?: { name: string; src: string }[];
  /** Looping backdrop video. Set to null to fall back to the procedural canvas effect. */
  videoSrc?: string | null;
  /** Freeze the backdrop — used by the slide exporter. */
  still?: boolean;
  /** Which frame (seconds) the frozen backdrop lands on. */
  stillTime?: number;
  className?: string;
}

export function Hero({
  eyebrow = "{Tech: Europe} × VEED — 22 August 2026",
  wordmark = "apic",
  headline = "An MCP server that manufactures MCP servers.",
  sub = "When an agent hits an app with no API, it calls apic. A computer-use agent operates the UI, verifies what actually changed, and hands back typed tools — then repairs them when the UI moves.",
  stages = STAGES,
  partners = PARTNERS,
  videoSrc = "/hero.webm",
  still = false,
  stillTime = 1.0,
  className,
}: HeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (still) {
      v.pause();
      const seek = () => { v.currentTime = stillTime; };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
      return;
    }

    // Autoplay can be deferred until the element has data or the tab is visible.
    // A silently-swallowed rejection leaves a frozen backdrop, so retry on both.
    const start = () => { void v.play().catch(() => {}); };
    start();
    v.addEventListener("canplay", start);
    v.addEventListener("loadeddata", start);
    document.addEventListener("visibilitychange", start);
    return () => {
      v.removeEventListener("canplay", start);
      v.removeEventListener("loadeddata", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [still, stillTime, videoSrc]);

  return (
    <div className={cn("relative isolate flex h-dvh w-full items-center justify-center overflow-hidden bg-[#0a0509] pb-[24vh]", className)}>
      {videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          data-hero-video
        />
      ) : (
        <AsciiSunset className="absolute inset-0" params={still ? { animated: false } : undefined} />
      )}

      {/* Carries the backdrop into the next section so the seam is not a hard edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-56"
        style={{ background: "linear-gradient(to bottom, rgba(10,5,9,0) 0%, rgba(10,5,9,0.65) 55%, #0a0509 100%)" }}
        aria-hidden
      />

      {/* Scrim: keeps the type readable without flattening the backdrop. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: [
            "linear-gradient(to bottom, rgba(10,5,9,0.78) 0%, rgba(10,5,9,0.42) 44%, rgba(10,5,9,0.1) 72%)",
            "radial-gradient(72% 42% at 50% 36%, rgba(10,5,9,0.55) 0%, rgba(10,5,9,0) 72%)",
          ].join(", "),
        }}
      />

      <div className="relative z-20 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className="mb-7 font-mono text-[13px] text-white/50">
          {eyebrow}
        </p>

        <h1
          className="font-extrabold leading-[0.8] tracking-[-0.06em] text-white [font-family:var(--font-display)]"
          style={{
            fontSize: "clamp(3.5rem, 13.5vw, 10rem)",
            textShadow: "0 0 90px rgba(255,110,40,0.45), 0 2px 40px rgba(0,0,0,0.6)",
          }}
        >
          {wordmark}
        </h1>

        <p
          className="mt-5 max-w-3xl text-balance font-bold leading-[1.02] tracking-[-0.04em] text-white [font-family:var(--font-display)]"
          style={{ fontSize: "clamp(1.25rem, 3.4vw, 2.4rem)", textShadow: "0 2px 30px rgba(0,0,0,0.75)" }}
        >
          {headline}
        </p>

        <p
          className="mt-5 max-w-2xl text-balance text-[15px] font-medium leading-relaxed text-white/85 sm:text-base"
          style={{ textShadow: "0 1px 18px rgba(8,3,7,0.95)" }}
        >
          {sub}
        </p>

        <div className="mt-9 hidden sm:block">
          <HoverTerminal command="claude mcp add apic -- node ./generated/vikunja/server.js" label="Install" width={560} />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[13px] text-white/45">
          {stages.map((stage, i) => (
            <span key={stage} className="flex items-center gap-3">
              {stage}
              {i < stages.length - 1 && <span className="text-white/20">→</span>}
            </span>
          ))}
        </div>

        {partners.length > 0 && (
          <div className="mt-9 flex flex-col items-center gap-4">
            <p
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40"
              style={{ textShadow: "0 1px 18px rgba(8,3,7,0.95)" }}
            >
              Built with
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
              {partners.map((p) => (
                <img
                  key={p.name}
                  src={p.src}
                  alt={p.name}
                  title={p.name}
                  height={18}
                  // The backdrop is a moving video, so the marks need the same
                  // separation the type gets from its text-shadow - at plain 50%
                  // opacity they disappear into the bright frames.
                  style={{ height: 18, width: "auto", filter: "drop-shadow(0 1px 14px rgba(8,3,7,0.95))" }}
                  className="shrink-0 opacity-70 transition-opacity duration-200 hover:opacity-100"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {!still && (
        <a
          href="#problem"
          className="absolute inset-x-0 bottom-8 z-20 mx-auto flex w-fit flex-col items-center gap-2 font-mono text-[13px] text-white/35 transition-colors hover:text-white/70"
        >
          Watch it run
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </div>
  );
}

export default Hero;
