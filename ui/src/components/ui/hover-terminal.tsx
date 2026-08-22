"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Terminal } from "lucide-react";

export interface HoverTerminalProps {
  /** The command revealed on hover, and copied on click unless `href` is set. */
  command: string;
  /** Collapsed button label. */
  label?: string;
  /** Expanded width. Set it to fit `command` — this cannot be measured before it renders. */
  width?: number;
  /**
   * Turns the control into a link. Clicking navigates instead of copying — for
   * when one command is a teaser and the real answer is a section listing every
   * client. The hover reveal is unchanged.
   */
  href?: string;
}

/**
 * Collapsed it reads as a button; hovered it becomes the command; clicked it copies.
 * Adapted from the 21st.dev original, which hardcoded `pip install <pkg>` and shipped
 * its own full-page wrapper.
 */
export function HoverTerminal({ command, label = "Install", width = 560, href }: HoverTerminalProps) {
  const [state, setState] = useState<"idle" | "hovered" | "copied">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (href) return; // the anchor navigates; nothing to copy
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      // Clipboard API is unavailable in some embedded contexts; the command is
      // still on screen and selectable, so fail quietly rather than alarm anyone.
    }
  };

  const Root = href ? motion.a : motion.button;

  return (
    <Root
      layout
      href={href}
      onClick={copy}
      onHoverStart={() => state !== "copied" && setState("hovered")}
      onHoverEnd={() => state !== "copied" && setState("idle")}
      aria-label={href ? `${label}: see the snippet for every client` : `Copy: ${command}`}
      className={`relative flex h-12 items-center justify-center overflow-hidden rounded-lg border font-mono text-sm transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        state === "hovered"
          ? "border-white/25 bg-white/[0.06]"
          : state === "copied"
            ? "border-emerald-500/50 bg-emerald-500/10"
            : "border-white/12 bg-white/[0.03]"
      }`}
      animate={{ width: state === "hovered" ? width : 150 }}
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === "idle" && (
          <motion.div
            key="idle" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.15 }} className="absolute flex items-center gap-2 text-white/80"
          >
            <Terminal size={15} className="text-white/40" />
            <span className="font-medium tracking-wide">{label}</span>
          </motion.div>
        )}

        {state === "hovered" && (
          <motion.div
            key="hovered" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.15 }} className="absolute flex w-full items-center gap-3 px-4"
          >
            <Terminal size={14} className="shrink-0 text-white/40" />
            <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-white/85">
              <span className="select-none text-white/35">~</span>
              <span className="whitespace-nowrap">{command}</span>
              <motion.div
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                className="h-4 w-1.5 shrink-0 bg-white/50"
              />
            </div>
          </motion.div>
        )}

        {state === "copied" && (
          <motion.div
            key="copied" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.15 }} className="absolute flex items-center gap-2 text-emerald-400"
          >
            <Check size={16} />
            <span className="font-medium">Copied</span>
          </motion.div>
        )}
      </AnimatePresence>
    </Root>
  );
}

export default HoverTerminal;
