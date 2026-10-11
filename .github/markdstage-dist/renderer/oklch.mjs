// Perceptual colour maths (OKLab / OKLCh) used when a diagram imported from an
// external tool has to be repainted in the deck's theme.
//
// Rotating hues in HSL keeps the raw saturation of whatever accent the theme
// defines, which turns vivid accents into neon and muted accents into mud. OKLCh
// separates lightness and chroma from hue, so a family of category colours can be
// spun off a single accent while every member keeps the accent's perceived
// lightness and colourfulness. That is what makes an imported diagram look like it
// belongs to the deck rather than like a pasted screenshot.
//
// Conversions follow Björn Ottosson's OKLab definition and the sRGB transfer
// function; they are self-contained so the renderer keeps its zero-dependency rule.

const SRGB_FROM_LINEAR_THRESHOLD = 0.0031308;
const LINEAR_FROM_SRGB_THRESHOLD = 0.04045;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function linearFromSrgb(channel) {
  return channel <= LINEAR_FROM_SRGB_THRESHOLD
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function srgbFromLinear(channel) {
  return channel <= SRGB_FROM_LINEAR_THRESHOLD
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Convert sRGB channels in 0..255 to OKLab. */
export function rgbToOklab([red, green, blue]) {
  const r = linearFromSrgb(clamp(red, 0, 255) / 255);
  const g = linearFromSrgb(clamp(green, 0, 255) / 255);
  const b = linearFromSrgb(clamp(blue, 0, 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Convert OKLab back to sRGB channels in 0..255, clipping out-of-gamut results. */
export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [red, green, blue].map((channel) =>
    Math.round(clamp(srgbFromLinear(channel), 0, 1) * 255),
  );
}

/** Convert sRGB channels in 0..255 to OKLCh (hue in degrees). */
export function rgbToOklch(rgb) {
  const { L, a, b } = rgbToOklab(rgb);
  const chroma = Math.sqrt(a * a + b * b);
  // A neutral colour has no meaningful hue; report 0 so callers can special-case it.
  const hue = chroma < 1e-6 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: chroma, h: (hue + 360) % 360 };
}

/** Convert OKLCh (hue in degrees) to sRGB channels in 0..255. */
export function oklchToRgb({ L, C, h }) {
  const radians = (h * Math.PI) / 180;
  return oklabToRgb({
    L: clamp(L, 0, 1),
    a: Math.max(C, 0) * Math.cos(radians),
    b: Math.max(C, 0) * Math.sin(radians),
  });
}

/**
 * Blend two sRGB colours in OKLab.
 *
 * Averaging sRGB channels darkens mixtures of saturated colours; OKLab is
 * perceptually uniform, so a 50% mix actually reads as the midpoint. This is what
 * produces readable translucent-looking fills without using real transparency.
 */
export function mixOklab(fromRgb, toRgb, ratio) {
  const amount = clamp(ratio, 0, 1);
  const from = rgbToOklab(fromRgb);
  const to = rgbToOklab(toRgb);
  return oklabToRgb({
    L: from.L + (to.L - from.L) * amount,
    a: from.a + (to.a - from.a) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

/** Relative luminance used for the WCAG contrast ratio. */
function relativeLuminance([red, green, blue]) {
  const [r, g, b] = [red, green, blue].map((channel) =>
    linearFromSrgb(clamp(channel, 0, 255) / 255),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two sRGB colours (1..21). */
export function contrastRatio(foreground, background) {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const [high, low] = light >= dark ? [light, dark] : [dark, light];
  return (high + 0.05) / (low + 0.05);
}

/**
 * Nudge `rgb` along the OKLCh lightness axis until it reaches `minimumRatio`
 * against `backgroundRgb`, keeping its hue and chroma.
 *
 * Derived category colours can land too close to the surface on one theme even
 * though they are fine on another. Adjusting lightness only is the smallest change
 * that restores legibility without breaking the family's colour relationships.
 */
export function ensureContrast(rgb, backgroundRgb, minimumRatio) {
  if (contrastRatio(rgb, backgroundRgb) >= minimumRatio) return rgb;
  const { L, C, h } = rgbToOklch(rgb);
  // Move away from the background: lighten on dark surfaces, darken on light ones.
  const towards = relativeLuminance(backgroundRgb) < 0.5 ? 1 : 0;
  let low = L;
  let high = towards;
  let best = oklchToRgb({ L: towards, C, h });
  if (contrastRatio(best, backgroundRgb) < minimumRatio) return best;
  // 12 bisection steps resolve lightness far below one 8-bit step.
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) / 2;
    const candidate = oklchToRgb({ L: middle, C, h });
    if (contrastRatio(candidate, backgroundRgb) >= minimumRatio) {
      best = candidate;
      high = middle;
    } else {
      low = middle;
    }
  }
  return best;
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/i;

/**
 * Parse the colour formats the renderer already resolves theme tokens into
 * (`#rgb`, `#rrggbb`, with optional alpha, and `rgb()`/`rgba()`).
 * Returns null for anything else so callers can fall back instead of guessing.
 */
export function parseRgb(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const hex = text.match(HEX_PATTERN);
  if (hex) {
    const digits = hex[1];
    const expand = digits.length <= 4
      ? [...digits].map((character) => character + character).join("")
      : digits;
    return [0, 2, 4].map((offset) => parseInt(expand.slice(offset, offset + 2), 16));
  }
  const rgb = text.match(RGB_PATTERN);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return parts.map((part) => clamp(Math.round(part), 0, 255));
  }
  return null;
}

/** Format sRGB channels as `#rrggbb`, the form the scene graph accepts. */
export function formatHex([red, green, blue]) {
  return `#${[red, green, blue]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
