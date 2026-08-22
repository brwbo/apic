import { useState } from "react";

export interface DemoProps {
  /** Drop the Loom export at ui/public/demo.mp4 (or .webm) and it appears here. */
  src?: string;
  poster?: string;
}

export function Demo({ src = "/demo.mp4", poster }: DemoProps) {
  const [missing, setMissing] = useState(false);

  return (
    <section id="demo" className="border-t border-white/10 bg-[#08040e] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-primary/80">The demo</p>
        <h2 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl">
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
            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
              apic — compile &amp; heal
            </span>
          </div>

          <div className="relative aspect-video w-full bg-black">
            {missing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.04]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-[1px] fill-white/50" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
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
