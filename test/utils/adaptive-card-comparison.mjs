import assert from "node:assert/strict";

export const CARD_EDGE_TOLERANCE = 2;
export const CARD_TEXT_RECT_TOLERANCE = 3;

export function compareCardGeometry(reference, actual) {
  const measurements = [];
  const bounds = (left, right, path, tolerance) => {
    assert.equal(Boolean(left), Boolean(right), `${path}: missing geometry`);
    if (!left) return;
    for (const [name, a, b] of [
      ["left", left.x, right.x], ["top", left.y, right.y],
      ["right", left.x + left.width, right.x + right.width],
      ["bottom", left.y + left.height, right.y + right.height],
    ]) {
      const delta = Math.round(Math.abs(a - b) * 1000) / 1000;
      assert.ok(Number.isFinite(delta), `${path}.${name}: non-finite geometry`);
      measurements.push({ path: `${path}.${name}`, delta, tolerance });
    }
  };
  assert.equal(actual.length, reference.length, "slide count");
  for (const [index, slide] of reference.entries()) {
    assert.equal(actual[index].cards.length, slide.cards.length, `slide ${index}: card count`);
    for (const [cardIndex, card] of slide.cards.entries()) {
      const other = actual[index].cards[cardIndex];
      assert.deepEqual(other.diagnostics, card.diagnostics, "card diagnostics");
      assert.equal(other.status, card.status, "card status");
      assert.equal(other.objects.length, card.objects.length, "typed object count");
      bounds(card.bounds, other.bounds, `${index}.${cardIndex}`, CARD_EDGE_TOLERANCE);
      for (const [objectIndex, object] of card.objects.entries()) {
        const counterpart = other.objects[objectIndex];
        const { bounds: box, separatorBounds, textRects, ...semantics } = object;
        const { bounds: otherBox, separatorBounds: otherSeparator, textRects: otherText, ...otherSemantics } = counterpart;
        assert.deepEqual(otherSemantics, semantics, object.sourcePath);
        bounds(box, otherBox, object.sourcePath, CARD_EDGE_TOLERANCE);
        bounds(separatorBounds, otherSeparator, `${object.sourcePath}.separator`, CARD_EDGE_TOLERANCE);
        assert.equal(otherText.length, textRects.length, `${object.sourcePath}: text layout changed`);
        textRects.forEach((rect, rectIndex) => bounds(rect, otherText[rectIndex],
          `${object.sourcePath}.textRects[${rectIndex}]`, CARD_TEXT_RECT_TOLERANCE));
      }
    }
  }
  return {
    edgeTolerance: CARD_EDGE_TOLERANCE, textRectTolerance: CARD_TEXT_RECT_TOLERANCE,
    maximumEdgeDelta: Math.max(0, ...measurements.filter((item) => item.tolerance === CARD_EDGE_TOLERANCE).map((item) => item.delta)),
    maximumTextRectDelta: Math.max(0, ...measurements.filter((item) => item.tolerance === CARD_TEXT_RECT_TOLERANCE).map((item) => item.delta)),
    violations: measurements.filter((item) => item.delta > item.tolerance),
    measuredEdges: measurements.length,
  };
}

// Image comparisons are supporting evidence, not a substitute for edge/text,
// missing-object and occlusion review.
export async function compareCardPngs(page, reference, actual) {
  return page.evaluate(async ({ left, right }) => {
    const images = await Promise.all([left, right].map(async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image;
    }));
    if (images.some((image) => image.width !== 1280 || image.height !== 720)) throw new Error("Expected 1280x720 images.");
    const canvas = document.createElement("canvas"); canvas.width = 2560; canvas.height = 720;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    images.forEach((image, index) => context.drawImage(image, index * 1280, 0));
    const a = context.getImageData(0, 0, 1280, 720).data, b = context.getImageData(1280, 0, 1280, 720).data;
    let changedPixels = 0, changedPixelsOver20 = 0;
    for (let offset = 0; offset < a.length; offset += 4) {
      const delta = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a[offset + channel] - b[offset + channel])));
      if (delta) changedPixels++;
      if (delta > 20) changedPixelsOver20++;
    }
    const sideBySide = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = 1280;
    context.drawImage(images[0], 0, 0);
    context.globalAlpha = 0.5;
    context.drawImage(images[1], 0, 0);
    return { changedPixels, changedPixelsOver20, sideBySide, overlay: canvas.toDataURL("image/png").split(",")[1] };
  }, { left: reference.toString("base64"), right: actual.toString("base64") });
}
