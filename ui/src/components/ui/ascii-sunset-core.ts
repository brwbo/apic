/* ASCII render pipeline — steps 1-3 of the effect. Component lives in ascii-sunset.tsx. */

/* ------------------------------------------------------------------ *
 * Types — mirrors the 21st.dev ASCII editor parameter set.
 * ------------------------------------------------------------------ */

export type RenderMode =
  | "characters" | "dither" | "mosaic" | "pixel" | "dots" | "cross" | "diamond"
  | "voxel" | "lego" | "mixed" | "lines" | "diagonal" | "braille" | "disco"
  | "hexdump" | "matrix" | "rings" | "hearts" | "stars" | "hexagons"
  | "triangles" | "bubbles" | "hatch" | "contour" | "halfblocks";

export type AnimStyle = "wave" | "pulse" | "shimmer" | "ripple" | "flicker";

type Toggle = { enabled: boolean; intensity: number };

export interface AsciiParams {
  renderMode: RenderMode;
  bgMode: "solid" | "blur" | "photo" | "none";
  bgBlur: number;
  bgOpacity: number;
  cellSize: number;
  coverage: number;
  invert: boolean;
  styleBlend: GlobalCompositeOperation;
  charSet: "standard" | "blocks" | "minimal" | "custom";
  customChars: string;
  brightness: number;
  contrast: number;
  edgeEmphasis: number;
  density: number;
  toneCurve: { x: number; y: number }[];
  tint: string;
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  saturation: number;
  grayscale: number;
  blurType: "off" | "gaussian" | "directional";
  blurAmount: number;
  pfx: Record<string, Toggle>;
  animated: boolean;
  animStyle: AnimStyle;
  animSpeed: Toggle;
  animIntensity: Toggle;
  lights: { enabled: boolean; points: { x: number; y: number; radius: number; intensity: number }[] };
  mask: { enabled: boolean; invert: boolean; dataUrl: string | null };
}

/** The "Sunset" preset, verbatim from the editor export. */
export const SUNSET: AsciiParams = {
  renderMode: "dots",
  bgMode: "solid", bgBlur: 12, bgOpacity: 90,
  cellSize: 10, coverage: 100, invert: false, styleBlend: "source-over",
  charSet: "standard", customChars: "",
  brightness: 0, contrast: 115, edgeEmphasis: 0, density: 0,
  toneCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  tint: "#ff3b1f", tintOpacity: 32, overlayBlend: "overlay",
  saturation: 100, grayscale: 0,
  blurType: "off", blurAmount: 35,
  pfx: {
    vignette: { enabled: true, intensity: 55 },
    scanLines: { enabled: false, intensity: 40 },
    chromatic: { enabled: false, intensity: 15 },
    bloom: { enabled: true, intensity: 45 },
    filmGrain: { enabled: false, intensity: 30 },
    glitch: { enabled: false, intensity: 20 },
    pixelate: { enabled: false, intensity: 15 },
    halftone: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
  },
  animated: true, animStyle: "pulse",
  animSpeed: { enabled: true, intensity: 100 },
  animIntensity: { enabled: true, intensity: 60 },
  lights: { enabled: false, points: [] },
  mask: { enabled: false, invert: false, dataUrl: null },
};

export const CHARSETS: Record<string, string> = {
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  minimal: " .oO@",
};

/* ------------------------------------------------------------------ *
 * Step 1 — the source raster.
 * Procedural sunset so the effect ships with no image asset.
 * Pass `sourceUrl` to use a real photo instead.
 * ------------------------------------------------------------------ */

export const HORIZON = 0.875;
export const SUN = { x: 0.5, y: 0.835, r: 0.17 };

export function paintSunset(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, "#1b1136");
  sky.addColorStop(0.17, "#3d1d61");
  sky.addColorStop(0.33, "#71277a");
  sky.addColorStop(0.47, "#ac3573");
  sky.addColorStop(0.58, "#dd4f3e");
  sky.addColorStop(0.66, "#f5842a");
  sky.addColorStop(HORIZON, "#ffcf7a");
  sky.addColorStop(HORIZON + 0.004, "#2c1338");
  sky.addColorStop(1.0, "#080410");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sun disc, clipped at the horizon.
  const sr = SUN.r * h;
  const sun = ctx.createRadialGradient(SUN.x * w, SUN.y * h, 0, SUN.x * w, SUN.y * h, sr);
  sun.addColorStop(0.0, "#fff6cf");
  sun.addColorStop(0.34, "#ffd166");
  sun.addColorStop(0.62, "#ff7a1f");
  sun.addColorStop(1.0, "rgba(255,90,20,0)");
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, HORIZON * h);
  ctx.clip();
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Cloud bands across the lower sky.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (const [cy, cw, ch, a] of [
    [0.5, 0.62, 0.014, 0.34], [0.6, 0.78, 0.011, 0.28],
    [0.69, 0.5, 0.009, 0.36], [0.77, 0.9, 0.008, 0.26],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * cy, w * cw, h * ch, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(60,20,60,${a})`;
    ctx.fill();
  }
  ctx.restore();

  // Reflection column on the water, with horizontal chop.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HORIZON * h, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  const refl = ctx.createLinearGradient(0, HORIZON * h, 0, h);
  refl.addColorStop(0, "rgba(255,150,50,0.85)");
  refl.addColorStop(1, "rgba(255,90,20,0)");
  for (let y = HORIZON * h; y < h; y += Math.max(3, h * 0.012)) {
    const t = (y - HORIZON * h) / (h - HORIZON * h);
    const halfW = (0.055 + t * 0.28) * w * (0.75 + 0.45 * Math.sin(y * 0.35));
    ctx.fillStyle = refl;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.fillRect(SUN.x * w - halfW, y, halfW * 2, Math.max(2, h * 0.007));
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Step 2 — sample the raster into a cell grid.
 * ------------------------------------------------------------------ */

export interface Grid { cols: number; rows: number; r: Float32Array; g: Float32Array; b: Float32Array; lum: Float32Array }

export function sample(src: CanvasRenderingContext2D, w: number, h: number, cell: number): Grid {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const n = cols * rows;
  const grid: Grid = {
    cols, rows,
    r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), lum: new Float32Array(n),
  };
  const data = src.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor(cell / 4)); // sub-sample for speed

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let r = 0, g = 0, b = 0, count = 0;
      const x1 = Math.min(w, (cx + 1) * cell);
      const y1 = Math.min(h, (cy + 1) * cell);
      for (let y = cy * cell; y < y1; y += step) {
        for (let x = cx * cell; x < x1; x += step) {
          const i = (y * w + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
      }
      if (!count) count = 1;
      const idx = cy * cols + cx;
      grid.r[idx] = r / count;
      grid.g[idx] = g / count;
      grid.b[idx] = b / count;
      grid.lum[idx] = (0.2126 * grid.r[idx] + 0.7152 * grid.g[idx] + 0.0722 * grid.b[idx]) / 255;
    }
  }
  return grid;
}

/** Piecewise-linear tone curve lookup. */
export function tone(v: number, curve: { x: number; y: number }[]) {
  if (curve.length < 2) return v;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (v <= b.x) {
      const t = b.x === a.x ? 0 : (v - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return curve[curve.length - 1].y;
}

/** Stable per-cell pseudo-random in [0,1) — keeps `coverage` from flickering. */
export function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ------------------------------------------------------------------ *
 * Step 3 — per-cell primitives.
 * ------------------------------------------------------------------ */

export function drawCell(
  ctx: CanvasRenderingContext2D, mode: RenderMode,
  x: number, y: number, cell: number, lum: number, color: string,
  charSet: string, idx: number, t: number,
) {
  const half = cell / 2;
  const cx = x + half, cy = y + half;
  const s = lum * cell;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  switch (mode) {
    case "dots":
    case "bubbles": {
      const r = (mode === "bubbles" ? 0.52 : 0.46) * s;
      if (r < 0.18) return;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (mode === "bubbles") { ctx.lineWidth = Math.max(0.6, r * 0.3); ctx.stroke(); }
      else ctx.fill();
      return;
    }
    case "characters": {
      const ch = charSet[Math.min(charSet.length - 1, Math.floor(lum * charSet.length))];
      if (ch === " ") return;
      ctx.font = `${cell}px var(--font-mono, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, cx, cy);
      return;
    }
    case "hexdump": {
      const ch = "0123456789abcdef"[Math.min(15, Math.floor(lum * 16))];
      ctx.font = `${cell * 0.9}px var(--font-mono, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, cx, cy);
      return;
    }
    case "matrix": {
      const ch = String.fromCharCode(0x30a0 + Math.floor(hash(idx + Math.floor(t * 6)) * 96));
      ctx.fillStyle = `rgba(0,255,120,${lum})`;
      ctx.font = `${cell}px var(--font-mono, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, cx, cy);
      return;
    }
    case "pixel": case "mosaic": case "lego": case "voxel":
      ctx.fillRect(x, y, Math.max(1, cell - 1), Math.max(1, cell - 1));
      if (mode === "lego") { ctx.beginPath(); ctx.arc(cx, cy, cell * 0.18, 0, Math.PI * 2); ctx.globalAlpha *= 0.6; ctx.fill(); ctx.globalAlpha /= 0.6; }
      return;
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx + s / 2, cy);
      ctx.lineTo(cx, cy + s / 2); ctx.lineTo(cx - s / 2, cy);
      ctx.closePath(); ctx.fill();
      return;
    case "cross":
      ctx.lineWidth = Math.max(0.5, s * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - s / 2, cy); ctx.lineTo(cx + s / 2, cy);
      ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx, cy + s / 2);
      ctx.stroke();
      return;
    case "lines": case "diagonal": case "hatch": {
      ctx.lineWidth = Math.max(0.4, s * 0.2);
      ctx.beginPath();
      if (mode === "lines") { ctx.moveTo(x, cy); ctx.lineTo(x + cell, cy); }
      else { ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y); }
      if (mode === "hatch" && lum > 0.5) { ctx.moveTo(x, y); ctx.lineTo(x + cell, y + cell); }
      ctx.stroke();
      return;
    }
    case "rings": case "contour":
      ctx.lineWidth = Math.max(0.5, cell * 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, s * 0.45), 0, Math.PI * 2);
      ctx.stroke();
      return;
    case "hexagons": {
      const r = s * 0.55;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath(); ctx.fill();
      return;
    }
    case "triangles":
      ctx.beginPath();
      ctx.moveTo(cx, cy - s / 2);
      ctx.lineTo(cx + s / 2, cy + s / 2);
      ctx.lineTo(cx - s / 2, cy + s / 2);
      ctx.closePath(); ctx.fill();
      return;
    case "stars": {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.22 : s * 0.55;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
          : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath(); ctx.fill();
      return;
    }
    case "hearts":
      ctx.font = `${s * 1.2}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("♥", cx, cy);
      return;
    case "braille": {
      ctx.fillText(String.fromCharCode(0x2800 + Math.floor(lum * 255)), cx, cy);
      return;
    }
    case "halfblocks":
      ctx.fillRect(x, y + (lum > 0.5 ? 0 : half), cell - 1, half - 0.5);
      return;
    case "disco":
      ctx.globalAlpha *= 0.5 + 0.5 * Math.sin(t * 3 + idx);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2); ctx.fill();
      return;
    case "dither": case "mixed": default: {
      if (lum < 0.5 && hash(idx) > lum * 2) return;
      ctx.fillRect(x, y, Math.max(1, cell - 1), Math.max(1, cell - 1));
      return;
    }
  }
}

