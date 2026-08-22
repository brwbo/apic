import { useState } from "react";
import { EdgeBlur } from "@/components/ui/edge-blur";
import { SectionLabel } from "@/components/section-label";

export interface DemoProps {
  /** Drop the Loom export at ui/public/demo.mp4 (or .webm) and it appears here. */
  src?: string;
  poster?: string;
}

export function Demo({ src = "/demo.mp4", poster }: DemoProps) {
  const [missing, setMissing] = useState(false);

  return (
    <section id="demo" className="border-t border-white/10 bg-[#0a0509] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>The demo</SectionLabel>
        <h2 className="mt-5 max-w-2xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          An agent hits an app with no API, and writes itself one.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          Two minutes, unedited: the compile, the generated tools appearing in a live session, and
          the watcher catching a UI change on its own.
        </p>

        <div className="mt-10 overflow-hidden rounded-xl border border-white/12 bg-black shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)]">
          {/* Browser chrome, so the frame reads as a recording rather than a hero loop. */}
          <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="ml-3 font-mono text-[12px] text-white/35">
              apic — compile &amp; heal
            </span>
          </div>

          <div className="relative aspect-video w-full overflow-hidden bg-black">
            <EdgeBlur position="bottom" height={70} />
            {missing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-[1px] fill-white/50" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p className="font-mono text-[13px] text-white/45">
                  Demo lands here
                </p>
                <p className="max-w-xs text-[12px] leading-relaxed text-white/30">
                  Save the recording to <code className="font-mono text-white/45">ui/public/demo.mp4</code> and
                  this frame picks it up — no code change.
                </p>
              </div>
            ) : (
              <video
                src={src}
                poster={poster}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full"
                onError={() => setMissing(true)}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Demo;
