import assert from "node:assert/strict";
import test from "node:test";

import {
  contrastRatio,
  ensureContrast,
  formatHex,
  mixOklab,
  oklchToRgb,
  parseRgb,
  rgbToOklch,
} from "../renderer/oklch.mjs";

const SAMPLES = [
  [0, 0, 0],
  [255, 255, 255],
  [18, 24, 38],
  [125, 211, 252],
  [217, 119, 6],
  [15, 108, 189],
];

test("parseRgb accepts every colour notation the renderer resolves to", () => {
  assert.deepEqual(parseRgb("#fff"), [255, 255, 255]);
  assert.deepEqual(parseRgb("#0F6CBD"), [15, 108, 189]);
  // A trailing alpha channel is dropped rather than rejected: the scene graph
  // carries opacity separately, so the colour itself is still usable.
  assert.deepEqual(parseRgb("#0f6cbdff"), [15, 108, 189]);
  assert.deepEqual(parseRgb("rgb(15, 108, 189)"), [15, 108, 189]);
  assert.deepEqual(parseRgb("rgba(15 108 189 / 0.5)"), [15, 108, 189]);
  assert.equal(parseRgb("transparent"), null);
  assert.equal(parseRgb(""), null);
  assert.equal(parseRgb("not a colour"), null);
});

test("OKLCh conversion round-trips every channel", () => {
  for (const rgb of SAMPLES) {
    const round = oklchToRgb(rgbToOklch(rgb));
    for (const [channel, value] of round.entries()) {
      assert.ok(
        Math.abs(value - rgb[channel]) <= 1,
        `${formatHex(rgb)} round-tripped to ${formatHex(round)}`,
      );
    }
  }
});

test("mixOklab interpolates between the two endpoints", () => {
  const from = [0, 0, 0];
  const to = [255, 255, 255];
  assert.deepEqual(mixOklab(from, to, 0), from);
  assert.deepEqual(mixOklab(from, to, 1), to);
  const middle = mixOklab(from, to, 0.5);
  // The perceptual midpoint, not the arithmetic one. OKLab lightness is uniform,
  // so half the perceived distance from black to white lands below sRGB's #808080.
  // This is exactly why the palette mixes here: an even ramp in OKLab keeps a
  // component fill the same perceived distance from its surface on every theme.
  assert.equal(formatHex(middle), "#636363");
  assert.ok(middle.every((channel) => channel > 0 && channel < 255));
});

test("contrastRatio matches the WCAG extremes", () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(contrastRatio([120, 120, 120], [120, 120, 120]), 1);
});

test("ensureContrast reaches the requested ratio against light and dark backgrounds", () => {
  for (const background of [[255, 255, 255], [17, 24, 39]]) {
    for (const rgb of SAMPLES) {
      const fixed = ensureContrast(rgb, background, 4.5);
      assert.ok(
        contrastRatio(fixed, background) >= 4.49,
        `${formatHex(rgb)} on ${formatHex(background)} stayed at ${contrastRatio(fixed, background)}`,
      );
    }
  }
});

test("ensureContrast keeps the hue so the palette still reads as one family", () => {
  const background = [255, 255, 255];
  const { h: hue, C: chroma } = rgbToOklch([125, 211, 252]);
  const fixed = rgbToOklch(ensureContrast([125, 211, 252], background, 4.5));
  const drift = Math.abs(((fixed.h - hue + 540) % 360) - 180);
  assert.ok(drift < 1, `hue moved by ${drift.toFixed(2)} degrees`);
  // Only lightness is allowed to move; chroma survives so the colour does not
  // wash out to grey while it is being darkened.
  assert.ok(fixed.C > chroma * 0.75, `chroma fell from ${chroma} to ${fixed.C}`);
});

test("ensureContrast leaves a colour that already passes untouched", () => {
  const rgb = [0, 0, 0];
  assert.deepEqual(ensureContrast(rgb, [255, 255, 255], 4.5), rgb);
});

test("formatHex always produces a six-digit hex string", () => {
  assert.equal(formatHex([15, 108, 189]), "#0f6cbd");
  assert.equal(formatHex([-20, 300, 12.6]), "#00ff0d");
});
