import { decodeBase64 } from "./output-model.mjs";

export async function captureOutputPng(cdp) {
  await cdp.send("Runtime.evaluate", {
    expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    awaitPromise: true,
  });
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: false,
  });
  if (typeof screenshot.data !== "string" || screenshot.data.length === 0) {
    throw new Error("Chromium DevTools did not return PNG data.");
  }
  return decodeBase64(screenshot.data);
}

// Runs in Chromium so PNG cropping needs no separate image codec dependency.
async function trimTransparentArtwork(data) {
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (right <= left || bottom <= top) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height, data };
  }
  const padding = 2;
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(canvas.width, right + padding);
  bottom = Math.min(canvas.height, bottom + padding);
  const width = right - left;
  const height = bottom - top;
  const cropped = context.getImageData(left, top, width, height);
  canvas.width = width;
  canvas.height = height;
  context.putImageData(cropped, 0, 0);
  return { x: left, y: top, width, height, data: canvas.toDataURL("image/png").split(",")[1] };
}

export async function capturePptxModel(cdp, total) {
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: "window.__presentationPptxModel", returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.text || "The renderer could not expose the PowerPoint model.");
  }
  const model = evaluated.result?.value;
  if (!model || !Array.isArray(model.masters) || !Array.isArray(model.layouts) ||
      !Array.isArray(model.slides) || model.slides.length !== total) {
    throw new Error("The renderer returned an invalid PowerPoint export model.");
  }
  await cdp.send("Runtime.evaluate", {
    expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    awaitPromise: true,
  });
  const layoutArtworks = [];
  for (const [index, layout] of model.layouts.entries()) {
    const captureIndex = Number.isInteger(layout.captureIndex) ? layout.captureIndex : total + index;
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: captureIndex * 720, width: 1280, height: 720, scale: 1 },
    });
    if (typeof screenshot.data !== "string" || screenshot.data.length === 0) {
      throw new Error(`Chromium did not return artwork for PowerPoint layout ${layout.id}.`);
    }
    layoutArtworks.push(decodeBase64(screenshot.data));
  }
  await cdp.send("Runtime.evaluate", {
    expression: "document.body.classList.remove('pptx-layout-artwork-mode');" +
      "document.body.classList.add('pptx-slide-artwork-mode');" +
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    awaitPromise: true,
  });
  await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const slideFallbackImages = [];
  for (const [slideIndex, slide] of model.slides.entries()) {
    const images = [];
    const fallbacks = Array.isArray(slide.fallbacks) ? slide.fallbacks : [];
    for (const [fallbackIndex, fallback] of fallbacks.entries()) {
      if (fallback?.artwork === false) continue;
      if (typeof fallback?.captureId !== "string" || !fallback.captureId) {
        throw new Error(`PowerPoint fallback ${fallbackIndex + 1} on slide ${slideIndex + 1} is missing its capture id.`);
      }
      const left = Math.max(0, Number(fallback?.x));
      const top = Math.max(0, Number(fallback?.y));
      const right = Math.min(1280, Number(fallback?.x) + Number(fallback?.width));
      const bottom = Math.min(720, Number(fallback?.y) + Number(fallback?.height));
      if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
        throw new Error(`PowerPoint fallback ${fallbackIndex + 1} on slide ${slideIndex + 1} has invalid bounds.`);
      }
      const trimMermaid = fallback.type === "mermaid" && fallback.reason === "mermaid-rendered-as-artwork";
      const bounds = fallback.type === "mermaid" ? {
        x: Math.floor(left), y: Math.floor(top),
        width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top),
      } : { x: left, y: top, width: right - left, height: bottom - top };
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const active = ${JSON.stringify(fallback.captureId)};
          for (const element of document.querySelectorAll("[data-pptx-fallback-ids]")) {
            const ids = (element.getAttribute("data-pptx-fallback-ids") || "").split(/\\s+/);
            element.classList.toggle("pptx-fallback-hidden", !ids.includes(active));
          }
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`,
        awaitPromise: true,
      });
      const screenshot = await cdp.send("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: true,
        clip: { x: bounds.x, y: slideIndex * 720 + bounds.y, width: bounds.width, height: bounds.height, scale: 1 },
      });
      if (typeof screenshot.data !== "string" || screenshot.data.length === 0) {
        throw new Error(`Chromium did not return fallback artwork ${fallbackIndex + 1} for slide ${slideIndex + 1}.`);
      }
      if (trimMermaid) {
        const cropped = await cdp.send("Runtime.evaluate", {
          expression: `(${trimTransparentArtwork.toString()})(${JSON.stringify(screenshot.data)})`,
          awaitPromise: true, returnByValue: true,
        });
        const result = cropped.result?.value;
        if (cropped.exceptionDetails || !result ||
            ![result.x, result.y, result.width, result.height].every(Number.isInteger) ||
            result.x < 0 || result.y < 0 || result.width <= 0 || result.height <= 0 ||
            result.x + result.width > bounds.width || result.y + result.height > bounds.height ||
            typeof result.data !== "string" || !result.data) {
          throw new Error(`Chromium could not trim Mermaid artwork ${fallbackIndex + 1} on slide ${slideIndex + 1}.`);
        }
        bounds.x += result.x;
        bounds.y += result.y;
        bounds.width = result.width;
        bounds.height = result.height;
        screenshot.data = result.data;
      }
      images.push({ fallbackIndex, ...bounds, data: decodeBase64(screenshot.data) });
    }
    slideFallbackImages.push(images);
  }
  await cdp.send("Runtime.evaluate", {
    expression: 'document.querySelectorAll(".pptx-fallback-hidden").forEach(element => element.classList.remove("pptx-fallback-hidden"));',
  });
  return { model, layoutArtworks, slideFallbackImages };
}
