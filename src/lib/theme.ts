/** Builds the CSS variables for a school's brand colours from one hex each. */
type RGB = [number, number, number];

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as RGB;
const triple = (c: RGB) => `${c[0]} ${c[1]} ${c[2]}`;

// The chosen colour becomes shade 600; lighter shades mix toward white, darker toward black.
const STEPS: [number, "w" | "b", number][] = [
  [50, "w", 0.92], [100, "w", 0.84], [200, "w", 0.68], [300, "w", 0.5], [400, "w", 0.3], [500, "w", 0.14],
  [600, "w", 0], [700, "b", 0.16], [800, "b", 0.32], [900, "b", 0.46], [950, "b", 0.64]
];

const relLum = (c: RGB) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG AA for normal text: white on the button colour must reach 4.5:1. */
const AA = 4.5;

/**
 * A school may pick any colour, but buttons and links must stay readable: if
 * white text on the chosen colour is below 4.5:1, it is darkened (same hue)
 * until it passes. Most brand colours pass unchanged.
 */
export function accessibleBase(c: RGB): RGB {
  let out = c;
  for (let i = 0; i < 30 && 1.05 / (relLum(out) + 0.05) < AA; i++) out = mix(out, [0, 0, 0], 0.06);
  return out;
}

// Accent: the chosen colour is the fill (shade 500) exactly as picked; it is a highlight, never body text.
const ACCENT_STEPS: [number, "w" | "b", number][] = [
  [50, "w", 0.9], [100, "w", 0.78], [200, "w", 0.6], [300, "w", 0.4], [400, "w", 0.2],
  [500, "w", 0], [600, "b", 0.1], [700, "b", 0.3], [800, "b", 0.5], [900, "b", 0.66]
];
const INK: RGB = [21, 20, 17];
const WHITE: RGB = [255, 255, 255];
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

export function paletteVars(name: "brand" | "accent", hex: string | null | undefined): Record<string, string> {
  const picked = hex ? hexToRgb(hex) : null;
  if (!picked) return {};
  const out: Record<string, string> = {};
  if (name === "accent") {
    for (const [step, dir, t] of ACCENT_STEPS) out[`--accent-${step}`] = triple(mix(picked, dir === "w" ? WHITE : [0, 0, 0], t));
    // Text on the accent: whichever of ink or white reads better on it.
    out["--accent-ink"] = triple(contrast(picked, INK) >= contrast(picked, WHITE) ? INK : WHITE);
    return out;
  }
  const base = accessibleBase(picked);
  for (const [step, dir, t] of STEPS) out[`--brand-${step}`] = triple(mix(base, dir === "w" ? WHITE : [0, 0, 0], t));
  return out;
}

/** WCAG relative luminance; white text needs the colour to be darker than ~0.4. */
export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}
