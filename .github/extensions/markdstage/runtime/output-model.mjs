import { getOutputSnapshotSlides } from "../deck-state.mjs";
import { normalizeTheme } from "../renderer/theme.mjs";
import { MarkdStageError } from "./errors.mjs";
import { sanitizeLayoutReport } from "./layout-report.mjs";
import {
  MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, checkImageBytes,
  decodePercentImageData, inspectImageSource,
} from "../renderer/image-source.mjs";
import { buildPptxPackage, inspectPptxPackage, PPTX_DIMENSIONS } from "./pptx-package.mjs";

export const MAX_CAPTURE_SLIDES = 10;
export const MAX_PPTX_ASSET_BYTES = MAX_IMAGE_BYTES;
export const MAX_PPTX_TOTAL_ASSET_BYTES = MAX_TOTAL_IMAGE_BYTES;

export function decodeBase64(data) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

export function createOutputSnapshot(inst, requestedTheme) {
  const theme = requestedTheme === undefined ? inst.theme : normalizeTheme(requestedTheme);
  return {
    slides: getOutputSnapshotSlides(inst),
    theme,
    themeLocked: inst.themeLocked,
    customThemeCss: inst.customThemeCss,
    customThemeMeta: inst.customThemeMeta,
  };
}

export function createOutputJob(snapshot, kind, options = {}) {
  return {
    slides: snapshot.slides,
    theme: snapshot.theme,
    themeLocked: snapshot.themeLocked,
    customThemeCss: snapshot.customThemeCss,
    customThemeMeta: snapshot.customThemeMeta,
    kind,
    mermaidImageFallback: options.mermaidImageFallback === true,
    status: "pending",
    error: "",
    layout: null,
  };
}

function ensurePptxAssetSize(data, label, currentTotal) {
  checkImageBytes(data.length, label, currentTotal);
}

async function loadPptxImage(inst, source, fetchImpl, currentTotal, label) {
  const image = inspectImageSource(source, label);
  if (image) {
    checkImageBytes(image.byteLength, label, currentTotal);
    const data = image.base64
      ? decodeBase64(image.payload)
      : new Uint8Array(decodePercentImageData(image));
    return { data, contentType: image.contentType };
  }
  const base = new URL(inst.url);
  const url = new URL(source, base);
  if (url.origin !== base.origin) {
    throw new Error(`${label}: image must be served by the MarkdStage workspace`);
  }
  const response = await fetchImpl(url, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`${label}: could not load image (${response.status})`);
  const data = new Uint8Array(await response.arrayBuffer());
  ensurePptxAssetSize(data, label, currentTotal);
  const responseType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const contentType = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"].includes(responseType)
    ? responseType : undefined;
  return { data, contentType };
}

export async function preparePptxPackageModel(inst, model, layoutArtworks, slideFallbackImages, fetchImpl = fetch) {
  if (!model || model.version !== 1 ||
      model.width !== PPTX_DIMENSIONS.widthPx || model.height !== PPTX_DIMENSIONS.heightPx ||
      !Array.isArray(model.masters) || model.masters.length === 0 ||
      !Array.isArray(model.layouts) || model.layouts.length === 0 ||
      !Array.isArray(model.slides) || model.slides.length === 0) {
    throw new Error("The renderer returned an unsupported PowerPoint export model.");
  }
  if (!Array.isArray(layoutArtworks) || layoutArtworks.length !== model.layouts.length) {
    throw new Error("PowerPoint layout artwork does not match the layout count.");
  }
  if (!Array.isArray(slideFallbackImages) ||
      slideFallbackImages.length !== model.slides.length ||
      slideFallbackImages.some((images) => !Array.isArray(images))) {
    throw new Error("PowerPoint fallback images do not match the slide count.");
  }
  const assets = [];
  const sourceAssets = new Map();
  const pngAssets = new Map();
  let totalAssetBytes = 0;
  const addPngAsset = async (id, data, label) => {
    if (!(data instanceof Uint8Array)) throw new Error(`${label} is invalid.`);
    ensurePptxAssetSize(data, label, 0);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const existing = pngAssets.get(key);
    if (existing) return existing;
    ensurePptxAssetSize(data, label, totalAssetBytes);
    totalAssetBytes += data.length;
    assets.push({ id, contentType: "image/png", data });
    pngAssets.set(key, id);
    return id;
  };
  const prepareImage = async (sourceElement, label) => {
    const source = sourceElement.src;
    let assetId = sourceAssets.get(source);
    if (!assetId) {
      const loaded = await loadPptxImage(inst, source, fetchImpl, totalAssetBytes, label);
      totalAssetBytes += loaded.data.length;
      assetId = `markdstage-image-${sourceAssets.size + 1}`;
      sourceAssets.set(source, assetId);
      assets.push({ id: assetId, ...loaded });
    }
    const { src: _src, source: _source, ...image } = sourceElement;
    if ((image.fit === "contain" || image.fit === "scale-down") &&
        image.naturalWidth > 0 && image.naturalHeight > 0) {
      const scale = Math.min(image.width / image.naturalWidth, image.height / image.naturalHeight,
        image.fit === "scale-down" ? 1 : Number.POSITIVE_INFINITY);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      image.x += (image.width - width) / 2;
      image.y += (image.height - height) / 2;
      image.width = width;
      image.height = height;
    }
    return { ...image, assetId };
  };
  const layouts = [];
  const layoutById = new Map();
  for (const [index, sourceLayout] of model.layouts.entries()) {
    if (!sourceLayout || typeof sourceLayout.id !== "string" || !sourceLayout.id ||
        typeof sourceLayout.name !== "string" || !sourceLayout.name ||
        typeof sourceLayout.theme !== "string" || !sourceLayout.theme) {
      throw new Error(`PowerPoint layout ${index + 1} is invalid.`);
    }
    if (layoutById.has(sourceLayout.id)) throw new Error(`PowerPoint layout id is duplicated: ${sourceLayout.id}`);
    const artworkAssetId = await addPngAsset(`markdstage-layout-${index + 1}`,
      layoutArtworks[index], `PowerPoint artwork for layout ${sourceLayout.id}`);
    const sourceElements = sourceLayout.elements ?? [];
    if (!Array.isArray(sourceElements) || sourceElements.some((element) => element?.type !== "image")) {
      throw new Error(`PowerPoint layout ${sourceLayout.id} has an invalid element list.`);
    }
    const elements = [];
    for (const [elementIndex, sourceElement] of sourceElements.entries()) {
      elements.push(await prepareImage(sourceElement, `PowerPoint layout ${index + 1} image ${elementIndex + 1}`));
    }
    const layout = { id: sourceLayout.id, name: sourceLayout.name, theme: sourceLayout.theme, artworkAssetId, elements };
    layoutById.set(layout.id, layout);
    layouts.push(layout);
  }
  const masters = model.masters.map((sourceMaster, index) => {
    if (!sourceMaster || typeof sourceMaster.id !== "string" || !sourceMaster.id ||
        typeof sourceMaster.theme !== "string" || !sourceMaster.theme ||
        !Array.isArray(sourceMaster.layoutIds) || sourceMaster.layoutIds.length === 0) {
      throw new Error(`PowerPoint master ${index + 1} is invalid.`);
    }
    const layoutIds = sourceMaster.layoutIds.map((layoutId) => {
      const layout = layoutById.get(layoutId);
      if (!layout || layout.theme !== sourceMaster.theme) {
        throw new Error(`PowerPoint master ${sourceMaster.id} references invalid layout ${layoutId}.`);
      }
      return layoutId;
    });
    return { id: sourceMaster.id, theme: sourceMaster.theme, layoutIds };
  });
  if (new Set(masters.map((master) => master.id)).size !== masters.length) {
    throw new Error("PowerPoint master ids must be unique.");
  }
  const slides = [];
  for (const [slideIndex, sourceSlide] of model.slides.entries()) {
    if (!sourceSlide || !Array.isArray(sourceSlide.elements)) {
      throw new Error(`PowerPoint slide ${slideIndex + 1} has an invalid element list.`);
    }
    if (typeof sourceSlide.layoutId !== "string" || !layoutById.has(sourceSlide.layoutId)) {
      throw new Error(`PowerPoint slide ${slideIndex + 1} references an invalid layout.`);
    }
    if (sourceSlide.notes !== undefined && typeof sourceSlide.notes !== "string") {
      throw new Error(`PowerPoint slide ${slideIndex + 1} has invalid speaker notes.`);
    }
    const elements = [];
    for (const [elementIndex, sourceElement] of sourceSlide.elements.entries()) {
      elements.push(sourceElement?.type !== "image" ? sourceElement :
        await prepareImage(sourceElement, `PowerPoint slide ${slideIndex + 1} image ${elementIndex + 1}`));
    }
    const fallbacks = Array.isArray(sourceSlide.fallbacks) ? sourceSlide.fallbacks : [];
    const expectedFallbackIndexes = fallbacks.map((fallback, fallbackIndex) => ({ fallback, fallbackIndex }))
      .filter(({ fallback }) => fallback?.artwork !== false);
    const captures = slideFallbackImages[slideIndex];
    if (captures.length !== expectedFallbackIndexes.length) {
      throw new Error(`PowerPoint fallback images do not match slide ${slideIndex + 1}.`);
    }
    const captureByFallback = new Map();
    for (const capture of captures) {
      if (!capture || !Number.isInteger(capture.fallbackIndex) || captureByFallback.has(capture.fallbackIndex)) {
        throw new Error(`PowerPoint fallback image for slide ${slideIndex + 1} is invalid.`);
      }
      captureByFallback.set(capture.fallbackIndex, capture);
    }
    const fallbackElements = [];
    for (const { fallback, fallbackIndex } of expectedFallbackIndexes) {
      const capture = captureByFallback.get(fallbackIndex);
      if (!capture) throw new Error(`PowerPoint fallback image ${fallbackIndex + 1} for slide ${slideIndex + 1} is missing.`);
      const assetId = await addPngAsset(`markdstage-slide-${slideIndex + 1}-fallback-${fallbackIndex + 1}`,
        capture.data, `PowerPoint fallback image ${fallbackIndex + 1} for slide ${slideIndex + 1}`);
      fallbackElements.push({
        type: "image", path: fallback.path, name: `${fallback.type || "Fallback"} artwork`,
        x: capture.x, y: capture.y, width: capture.width, height: capture.height,
        fit: "fill", opacity: 1,
        ...(Number.isFinite(fallback.zOrder) ? { zOrder: fallback.zOrder } : {}), assetId,
      });
    }
    const orderedElements = [...fallbackElements, ...elements]
      .map((element, elementIndex) => ({ element, elementIndex }))
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left.element.zOrder) ? left.element.zOrder : Number.POSITIVE_INFINITY;
        const rightOrder = Number.isFinite(right.element.zOrder) ? right.element.zOrder : Number.POSITIVE_INFINITY;
        return leftOrder - rightOrder || left.elementIndex - right.elementIndex;
      }).map(({ element }) => element);
    slides.push({
      layoutId: sourceSlide.layoutId, ...(sourceSlide.notes ? { notes: sourceSlide.notes } : {}),
      elements: orderedElements,
    });
  }
  return { masters, layouts, slides, assets };
}

export function selectLayoutResults(layout, requestedIndex, includeFits) {
  layout = sanitizeLayoutReport(layout);
  const selected = requestedIndex === undefined ? layout.slides :
    layout.slides.filter((slide) => slide.index === requestedIndex);
  const issueCount = selected.filter((slide) => slide.pdfClipped).length;
  return {
    ok: true, scope: requestedIndex === undefined ? "deck" : "slide",
    ...(requestedIndex === undefined ? {} : { index: requestedIndex, page: requestedIndex + 1 }),
    width: layout.width, height: layout.height, total: layout.total,
    inspected: selected.length, issueCount, hasIssues: issueCount > 0,
    slides: includeFits ? selected : selected.filter((slide) => slide.pdfClipped || slide.architecture?.length > 0),
  };
}

export function normalizeCaptureIndexes(requestedIndexes, total) {
  if (!Array.isArray(requestedIndexes) || requestedIndexes.length === 0) {
    throw new MarkdStageError("invalid_input", "indexes must be a non-empty array when provided.");
  }
  const indexes = [...new Set(requestedIndexes)];
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= total)) {
    throw new MarkdStageError("slide_out_of_range", `Every slide index must be an integer between 0 and ${total - 1}.`);
  }
  if (indexes.length > MAX_CAPTURE_SLIDES) {
    throw new MarkdStageError("too_many_slides", `At most ${MAX_CAPTURE_SLIDES} slides can be captured at once.`);
  }
  return indexes.sort((a, b) => a - b);
}

export function buildValidatedPptx(model, packageModel, total, title, dependencies = {}) {
  const buffer = (dependencies.buildPptxPackage ?? buildPptxPackage)({ title, ...packageModel });
  const summary = (dependencies.inspectPptxPackage ?? inspectPptxPackage)(buffer);
  const expectedNotes = model.slides.filter((slide) => typeof slide.notes === "string" && slide.notes.trim()).length;
  if (!summary.valid || summary.slideCount !== total || summary.notesCount !== expectedNotes ||
      summary.masterCount !== model.masters.length || summary.layoutCount !== model.layouts.length ||
      summary.dimensions.widthEmu !== PPTX_DIMENSIONS.widthEmu ||
      summary.dimensions.heightEmu !== PPTX_DIMENSIONS.heightEmu) {
    throw new Error("The generated PowerPoint package failed validation.");
  }
  return buffer;
}

export function pptxFallbackReport(model) {
  return model.slides.flatMap((slide, slideIndex) =>
    (Array.isArray(slide.fallbacks) ? slide.fallbacks : []).map((fallback) => {
      const { artwork: _artwork, captureId: _captureId, zOrder: _zOrder, ...reportedFallback } = fallback;
      return { slideIndex, page: slideIndex + 1, ...reportedFallback };
    }));
}

export function verifyPdfBytes(data) {
  if (data.length < 5 || new TextDecoder().decode(data.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The generated file does not have a PDF header.");
  }
  return data.length;
}

export function verifyPngBytes(data) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (data.length < 24 || signature.some((byte, index) => data[index] !== byte)) {
    throw new Error("The generated file does not have a PNG header.");
  }
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width !== 1280 || height !== 720) {
    throw new Error(`The generated PNG is ${width}x${height}; expected 1280x720.`);
  }
  return { bytes: data.length, width, height };
}
