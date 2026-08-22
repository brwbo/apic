"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  SUNSET, CHARSETS, SUN, paintSunset, sample, tone, hash, drawCell,
  type AsciiParams, type Grid,
} from "./ascii-sunset-core";

export { SUNSET } from "./ascii-sunset-core";
export type { AsciiParams, RenderMode, AnimStyle } from "./ascii-sunset-core";

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface AsciiSunsetProps extends React.HTMLAttributes<HTMLDivElement> {
  params?: Partial<AsciiParams>;
  /** Optional real photo. Falls back to the procedural sunset. */
  sourceUrl?: string;
  /** Solid colour used when bgMode === "solid". */
  bgColor?: string;
}

export function AsciiSunset({
  params: overrides, sourceUrl, bgColor = "#0a0511", className, children, ...rest
}: AsciiSunsetProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const p = React.useMemo<AsciiParams>(() => ({ ...SUNSET, ...overrides }), [overrides]);
  const [photo, setPhoto] = React.useState<HTMLImageElement | null>(null);

  React.useEffect(() => {
    if (!sourceUrl) return setPhoto(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setPhoto(img);
    img.src = sourceUrl;
  }, [sourceUrl]);

  React.useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const charSet = p.charSet === "custom" && p.customChars ? p.customChars : CHARSETS[p.charSet] ?? CHARSETS.standard;

    // Layers: src (the photo), fx (the cells), glow (quarter-res bloom).
    const src = document.createElement("canvas");
    const sctx = src.getContext("2d", { willReadFrequently: true })!;
    const fx = document.createElement("canvas");
    const fctx = fx.getContext("2d")!;
    const glow = document.createElement("canvas");
    const gctx = glow.getContext("2d")!;

    let grid: Grid | null = null;
    let W = 0, H = 0, raf = 0;

    const layout = () => {
      const { width, height } = host.getBoundingClientRect();
      W = Math.max(1, Math.round(width * dpr));
      H = Math.max(1, Math.round(height * dpr));
      canvas.width = W; canvas.height = H;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      src.width = W; src.height = H;
      fx.width = W; fx.height = H;
      glow.width = Math.max(1, W >> 2); glow.height = Math.max(1, H >> 2);

      // Step 1 — draw the source.
      if (photo) {
        const scale = Math.max(W / photo.width, H / photo.height);
        const dw = photo.width * scale, dh = photo.height * scale;
        sctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        paintSunset(sctx, W, H);
      }
      // Step 2 — sample the grid (once per resize, not per frame).
      grid = sample(sctx, W, H, Math.max(2, Math.round(p.cellSize * dpr)));
    };

    const frame = (ms: number) => {
      if (!grid) return;
      const t = reduced || !p.animated ? 0 : (ms / 1000);
      const cell = Math.max(2, Math.round(p.cellSize * dpr));
      const speed = (p.animSpeed.enabled ? p.animSpeed.intensity : 0) / 100;
      const amp = (p.animIntensity.enabled ? p.animIntensity.intensity : 0) / 100;

      // Step 1 — background.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (p.bgMode === "solid") {
        ctx.globalAlpha = p.bgOpacity / 100;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);
      } else if (p.bgMode === "blur" || p.bgMode === "photo") {
        ctx.globalAlpha = p.bgOpacity / 100;
        ctx.filter = p.bgMode === "blur" ? `blur(${p.bgBlur}px)` : "none";
        ctx.drawImage(src, 0, 0);
        ctx.filter = "none";
      }
      ctx.globalAlpha = 1;

      // Step 3 — cells.
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, W, H);
      const sunX = SUN.x * W, sunY = SUN.y * H;
      const maxD = Math.hypot(W, H);

      for (let cy = 0; cy < grid.rows; cy++) {
        for (let cx = 0; cx < grid.cols; cx++) {
          const i = cy * grid.cols + cx;
          if (p.coverage < 100 && hash(i) > p.coverage / 100) continue;

          let lum = tone(grid.lum[i], p.toneCurve);
          if (p.invert) lum = 1 - lum;
          if (p.density) lum = Math.max(0, Math.min(1, lum + p.density / 100));

          if (p.edgeEmphasis) {
            const l = cx > 0 ? grid.lum[i - 1] : grid.lum[i];
            const u = cy > 0 ? grid.lum[i - grid.cols] : grid.lum[i];
            lum = Math.min(1, lum + (Math.abs(grid.lum[i] - l) + Math.abs(grid.lum[i] - u)) * (p.edgeEmphasis / 100) * 4);
          }
          if (lum <= 0.008) continue;

          const x = cx * cell, y = cy * cell;

          // Step 8 — animation.
          let m = 1;
          if (t && amp) {
            const d = Math.hypot(x - sunX, y - sunY) / maxD;
            switch (p.animStyle) {
              case "pulse":   m = 1 + amp * 0.3 * Math.sin(t * 1.7 * speed - d * 7); break;
              case "wave":    m = 1 + amp * 0.35 * Math.sin(t * 2 * speed + (x / W) * 9); break;
              case "ripple":  m = 1 + amp * 0.4 * Math.sin(t * 3 * speed - d * 22); break;
              case "shimmer": m = 1 + amp * 0.3 * Math.sin(t * 6 * speed + hash(i) * 12); break;
              case "flicker": m = 1 - amp * 0.45 * hash(i + Math.floor(t * 14 * speed)); break;
            }
          }

          fctx.globalAlpha = 1;
          drawCell(
            fctx, p.renderMode, x, y, cell,
            Math.max(0, Math.min(1.2, lum * m)),
            `rgb(${grid.r[i] | 0},${grid.g[i] | 0},${grid.b[i] | 0})`,
            charSet, i, t,
          );
        }
      }

      // Step 4 — colour adjustments, then the cell layer onto the canvas.
      const adj = [
        p.brightness ? `brightness(${100 + p.brightness}%)` : "",
        p.contrast !== 100 ? `contrast(${p.contrast}%)` : "",
        p.saturation !== 100 ? `saturate(${p.saturation}%)` : "",
        p.grayscale ? `grayscale(${p.grayscale}%)` : "",
        p.blurType !== "off" ? `blur(${p.blurAmount / 10}px)` : "",
      ].filter(Boolean).join(" ");
      ctx.filter = adj || "none";
      ctx.globalCompositeOperation = p.styleBlend;
      ctx.drawImage(fx, 0, 0);
      ctx.filter = "none";

      // Step 4b — tint.
      if (p.tintOpacity > 0) {
        ctx.globalCompositeOperation = p.overlayBlend;
        ctx.globalAlpha = p.tintOpacity / 100;
        ctx.fillStyle = p.tint;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";

      // Step 5 — post-effects, in declared order.
      const fxOn = (k: string) => p.pfx[k]?.enabled ? p.pfx[k].intensity / 100 : 0;

      const scan = fxOn("scanLines");
      if (scan) {
        ctx.globalAlpha = scan * 0.4;
        ctx.fillStyle = "#000";
        for (let y = 0; y < H; y += 3 * dpr) ctx.fillRect(0, y, W, dpr);
        ctx.globalAlpha = 1;
      }

      const vig = fxOn("vignette");
      if (vig) {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.62);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${vig})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      const bloom = fxOn("bloom");
      if (bloom) {
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.clearRect(0, 0, glow.width, glow.height);
        gctx.filter = `blur(${Math.max(1, 3 * dpr)}px) brightness(150%)`;
        gctx.drawImage(fx, 0, 0, glow.width, glow.height);
        gctx.filter = "none";
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = bloom * 0.85;
        ctx.drawImage(glow, 0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }

      const chrom = fxOn("chromatic");
      if (chrom) {
        const o = chrom * 4 * dpr;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35;
        ctx.drawImage(fx, -o, 0);
        ctx.drawImage(fx, o, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }

      const grain = fxOn("filmGrain");
      if (grain) {
        ctx.globalAlpha = grain * 0.12;
        for (let i = 0; i < 900; i++) {
          const gx = Math.random() * W, gy = Math.random() * H;
          ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
          ctx.fillRect(gx, gy, dpr, dpr);
        }
        ctx.globalAlpha = 1;
      }

      // Step 6 — light points.
      if (p.lights.enabled) {
        ctx.globalCompositeOperation = "lighter";
        for (const pt of p.lights.points) {
          const g = ctx.createRadialGradient(pt.x * W, pt.y * H, 0, pt.x * W, pt.y * H, pt.radius * Math.min(W, H));
          g.addColorStop(0, `rgba(255,200,150,${pt.intensity / 100})`);
          g.addColorStop(1, "rgba(255,200,150,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      raf = requestAnimationFrame(frame);
    };

    layout();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(layout);
    ro.observe(host);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [p, photo, bgColor]);

  return (
    <div ref={hostRef} className={cn("relative isolate overflow-hidden", className)} {...rest}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      {children}
    </div>
  );
}

export default AsciiSunset;
