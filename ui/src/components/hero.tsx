import { useEffect, useRef } from "react";
import { AsciiSunset } from "@/components/ui/ascii-sunset";
import { cn } from "@/lib/utils";

const STAGES = ["Explore", "Perceive", "Synthesise", "Ground", "Verify", "Emit", "Heal", "Watch"];

export interface HeroProps {
  eyebrow?: string;
  wordmark?: string;
  headline?: string;
  sub?: string;
  stages?: string[];
  /** Looping backdrop video. Set to null to fall back to the procedural canvas effect. */
  videoSrc?: string | null;
  /** Freeze the backdrop — used by the slide exporter. */
  still?: boolean;
  /** Which frame (seconds) the frozen backdrop lands on. */
  stillTime?: number;
  className?: string;
}

export function Hero({
  eyebrow = "{Tech: Europe} × VEED · 22 August 2026",
  wordmark = "apic",
  headline = "An MCP server that manufactures MCP servers.",
  sub = "When an agent hits an app with no API, it calls apic. A computer-use agent operates the UI, verifies what actually changed, and hands back typed tools — then repairs them when the UI moves.",
  stages = STAGES,
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
    <div className={cn("relative isolate flex h-dvh w-full items-center justify-center overflow-hidden bg-[#08040e] pb-[29vh]", className)}>
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

      {/* Scrim: keeps the type readable without flattening the backdrop. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: [
            "linear-gradient(to bottom, rgba(6,3,14,0.78) 0%, rgba(6,3,14,0.42) 44%, rgba(6,3,14,0.1) 72%)",
            "radial-gradient(72% 42% at 50% 36%, rgba(6,3,14,0.55) 0%, rgba(6,3,14,0) 72%)",
          ].join(", "),
        }}
      />

      <div className="relative z-20 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.42em] text-white/55">
          {eyebrow}
        </p>

        <h1
          className="font-black leading-[0.82] tracking-[-0.055em] text-white"
          style={{
            fontSize: "clamp(3.5rem, 13.5vw, 10rem)",
            textShadow: "0 0 90px rgba(255,110,40,0.45), 0 2px 40px rgba(0,0,0,0.6)",
          }}
        >
          {wordmark}
        </h1>

        <p
          className="mt-5 max-w-3xl text-balance font-bold leading-[1.06] tracking-[-0.03em] text-white"
          style={{ fontSize: "clamp(1.25rem, 3.4vw, 2.4rem)", textShadow: "0 2px 30px rgba(0,0,0,0.75)" }}
        >
          {headline}
        </p>

        <p
          className="mt-5 max-w-2xl text-balance text-[15px] font-medium leading-relaxed text-white/85 sm:text-base"
          style={{ textShadow: "0 1px 18px rgba(4,2,10,0.95)" }}
        >
          {sub}
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-full bg-black/55 px-6 py-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-white/70 ring-1 ring-white/10 backdrop-blur-[2px]">
          {stages.map((stage, i) => (
            <span key={stage} className="flex items-center gap-3">
              {stage}
              {i < stages.length - 1 && <span className="text-white/20">→</span>}
            </span>
          ))}
        </div>
      </div>

      {!still && (
        <a
          href="#problem"
          className="absolute inset-x-0 bottom-8 z-20 mx-auto flex w-fit flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40 transition-colors hover:text-white/75"
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
