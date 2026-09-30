// Helpers for deterministically waiting for the renderer to finish.
//
// Detect completion through the renderer's ready signal rather than a fixed sleep.
//   Normal mode: the `mermaid-loading` class is removed from <body>
//   Print mode: <html data-print-ready="true"> and window.__presentationPrintReady === true
//               On failure: <html data-print-error="true">

/** CSS that stabilizes screenshots by disabling animation and hiding control UI. */
export const DETERMINISTIC_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  /* Control UI is not part of slide rendering, so exclude it from comparisons. */
  #nav, #overview { display: none !important; }
`;

export const CURRENT_SLIDE_IFRAME_SELECTOR =
  "#outputFrame, #presenterCurrent, .scroll-item[data-current='true'] iframe";
const SLIDE_READY_SELECTOR = `#stage .deck, ${CURRENT_SLIDE_IFRAME_SELECTOR}`;

/** Wait for layout (rAF-based auto-sizing) and font loading to settle. */
async function settleLayout(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // The renderer finalizes layout in two requestAnimationFrame calls. Run one additional frame
    // to ensure it has settled.
    await frame();
    await frame();
    await frame();
  });
}

class SlideSurface {
  constructor(page, framed) {
    this.page = page;
    this.framed = framed;
  }

  locator(selector, options) {
    return this.framed
      ? this.page.frameLocator(CURRENT_SLIDE_IFRAME_SELECTOR).locator(selector, options)
      : this.page.locator(selector, options);
  }

  async url() {
    return (await this.#target()).url();
  }

  async evaluate(pageFunction, arg) {
    return (await this.#target()).evaluate(pageFunction, arg);
  }

  async addStyleTag(options) {
    return (await this.#target()).addStyleTag(options);
  }

  async $eval(selector, pageFunction, arg) {
    return (await this.#target()).$eval(selector, pageFunction, arg);
  }

  async $$eval(selector, pageFunction, arg) {
    return (await this.#target()).$$eval(selector, pageFunction, arg);
  }

  async getAttribute(selector, name) {
    return this.locator(selector).first().getAttribute(name);
  }

  async waitForSelector(selector, options) {
    return (await this.#target(options?.timeout)).waitForSelector(selector, options);
  }

  async waitForFunction(pageFunction, arg, options) {
    return (await this.#target(options?.timeout)).waitForFunction(pageFunction, arg, options);
  }

  async #target(timeout = 60_000) {
    if (!this.framed) return this.page;
    await this.page.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)?.contentDocument),
      CURRENT_SLIDE_IFRAME_SELECTOR,
      { timeout },
    );
    const handle = await this.page.$(CURRENT_SLIDE_IFRAME_SELECTOR);
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error("Current slide frame is not available.");
    return frame;
  }
}

/** In normal mode, wait for one slide to finish rendering. */
export async function waitForSlideReady(page, { timeout = 60_000 } = {}) {
  await page.waitForFunction(
    (selector) => document.querySelector(selector),
    SLIDE_READY_SELECTOR,
    { timeout },
  );
  const frame = await getSlideFrame(page);
  await frame.waitForSelector("#stage .deck", { state: "attached", timeout });
  await frame.waitForFunction(
    () => !document.body.classList.contains("mermaid-loading"),
    undefined,
    { timeout },
  );
  await page.waitForFunction(
    () => !document.body.classList.contains("mermaid-loading"),
    undefined,
    { timeout },
  );
  await settleLayout(frame);
  return frame;
}

/** Resolve the slide document without confusing control UI with slide content. */
export async function getSlideFrame(page) {
  const element = await page.$(CURRENT_SLIDE_IFRAME_SELECTOR);
  return new SlideSurface(page, Boolean(element));
}

/**
 * In print mode, wait for all slides to finish rendering.
 * Also monitor the failure signal and throw with a reason when set. Without this check, an empty
 * PDF could be mistaken for success.
 */
export async function waitForPrintReady(page, { timeout = 120_000 } = {}) {
  await page.waitForFunction(
    () => {
      const root = document.documentElement;
      return (
        root.getAttribute("data-print-ready") === "true" ||
        root.getAttribute("data-print-error") === "true"
      );
    },
    undefined,
    { timeout },
  );

  const failed = await page.evaluate(
    () => document.documentElement.getAttribute("data-print-error") === "true",
  );
  if (failed) {
    throw new Error("Print rendering failed: <html data-print-error=\"true\"> was set.");
  }

  const ready = await page.evaluate(() => window.__presentationPrintReady === true);
  if (!ready) {
    throw new Error("Print rendering did not set window.__presentationPrintReady.");
  }
  await settleLayout(page);
}
