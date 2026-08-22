"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SHIMMER_STYLE_ID = "an-bash-tool-shimmer-styles";
const SHIMMER_STYLES = `
@keyframes an-bash-shimmer { from { background-position: 100% center; } to { background-position: 0% center; } }
.an-bash-shimmer {
  display: inline-block; background-size: 250% 100%;
  background-clip: text; -webkit-background-clip: text; color: transparent;
  background-image: linear-gradient(90deg, #a3a3a3 0%, #a3a3a3 40%, #525252 50%, #a3a3a3 60%, #a3a3a3 100%);
  background-repeat: no-repeat; animation: an-bash-shimmer 1.2s linear infinite;
}
@keyframes an-bash-dot { 0%, 60%, 100% { opacity: 0.2; } 30% { opacity: 1; } }
.an-bash-dot { animation: an-bash-dot 1.4s infinite; }
`;

let shimmerStylesInjected = false;
function ensureShimmerStyles() {
  if (typeof document === "undefined" || shimmerStylesInjected) return;
  if (document.getElementById(SHIMMER_STYLE_ID)) { shimmerStylesInjected = true; return; }
  const el = document.createElement("style");
  el.id = SHIMMER_STYLE_ID;
  el.textContent = SHIMMER_STYLES;
  document.head.appendChild(el);
  shimmerStylesInjected = true;
}

function extractCommandSummary(cmd: string): string {
  return cmd.split("|").map((s) => s.trim().split(/\s+/)[0] ?? "").filter(Boolean).slice(0, 4).join(", ");
}

export type BashToolProps = {
  /** "running" shows shimmer header + spinner. "idle" shows a static "Ran command:" header. */
  state?: "idle" | "running";
  /** Shell command, without the leading $. */
  command: string;
  /** Optional command output. Hidden while running. */
  output?: string;
  /** Override the header text — useful when the card is not literally a shell run. */
  label?: string;
  className?: string;
};

function Spinner() {
  return (
    <svg className="w-3 h-3 text-neutral-400 animate-spin shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="7" strokeLinecap="round" />
    </svg>
  );
}

export const BashTool = React.memo(function BashTool({
  state = "idle", command, output, label, className,
}: BashToolProps) {
  React.useEffect(() => { ensureShimmerStyles() }, []);
  const isRunning = state === "running";
  const summary = label ?? extractCommandSummary(command);

  return (
    <div className={cn("rounded-[10px] border border-white/12 bg-white/[0.03] overflow-hidden", className)}>
      <div className="flex items-center justify-between pl-2.5 pr-2 h-7">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {isRunning ? (
            <span className="an-bash-shimmer text-xs leading-none truncate">Running: {summary}</span>
          ) : (
            <span className="text-xs text-white/45 truncate">{label ? summary : `Ran command: ${summary}`}</span>
          )}
        </div>
        {isRunning && <Spinner />}
      </div>
      <div className="border-t border-white/10 px-2.5 py-1.5 font-mono text-[12px] leading-[16px] overflow-hidden bg-black/50">
        <div className="break-all">
          <span className="text-primary select-none">$ </span>
          <span className="text-white/90">{command}</span>
        </div>
        {!isRunning && output && (
          <div className="mt-1 text-white/45 whitespace-pre-line max-h-[110px] overflow-hidden">{output}</div>
        )}
      </div>
    </div>
  );
});
