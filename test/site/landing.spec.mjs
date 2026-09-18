import AxeBuilder from "@axe-core/playwright";

import {
  expect, expectNoHorizontalOverflow, expectVisibleImagesLoaded, localeUrl, test,
} from "./fixtures.mjs";
import { normalizeNewlines } from "./helpers.mjs";

const viewports = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow", width: 320, height: 844 },
];

for (const basePath of ["/", "/MarkdStage/"]) {
  for (const lang of ["ja", "en"]) {
    for (const viewport of viewports) {
      test(`${lang} ${viewport.name}: layout, images, language, and anchors at ${basePath}`, async ({ page, site }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(localeUrl(site, basePath, lang));
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await expect(page).toHaveTitle(site[lang].title);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator(".languages [aria-current='page']")).toHaveAttribute("lang", lang);
        await expectNoHorizontalOverflow(page);
        await expectVisibleImagesLoaded(page);
        if (lang === "ja") {
          for (const selector of ["#editor-title", "#needs-title", ".needs-list dd",
            "#workflow-title", "#share-title", ".share-formats p", "#start-title",
            ".platform-section h4", ".prompt-box pre"]) {
            const elements = page.locator(selector);
            for (const element of await elements.all()) {
              await expect(element).toHaveCSS("line-break", "strict");
              await expect(element).toHaveCSS("word-break", "auto-phrase");
            }
          }
          for (const heading of await page.locator("h2, h3, h4, h5, dt").all()) {
            await expect(heading).toHaveCSS("text-wrap", "balance");
          }
        }

        await page.locator("[data-example='architecture']").click();
        await expectVisibleImagesLoaded(page);
        await expectNoHorizontalOverflow(page);
        await page.locator("#example-architecture summary").click();
        await page.locator("#tab-node").click();
        await page.locator(".skill-setup summary").click();
        await page.locator(".cli-output summary").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#cli-command")).toBeVisible();
        await expectVisibleImagesLoaded(page);
        await expectNoHorizontalOverflow(page);
        await page.locator("#tab-copilot").click();
        await expect(page.locator("#canvas-prompt")).toBeVisible();
        await expectVisibleImagesLoaded(page);
        await expectNoHorizontalOverflow(page);

        await followStartLink(page);
        await expect(page).toHaveURL(`${localeUrl(site, basePath, lang)}#get-started`);
        await expect(page.locator("#start-title")).toBeInViewport();
        if (viewport.name === "desktop") {
          await page.locator(".main-nav a[href='#examples']").click();
          await expect(page).toHaveURL(`${localeUrl(site, basePath, lang)}#examples`);
          await expect(page.locator("#examples-title")).toBeInViewport();
        }
        const alternate = lang === "ja" ? "en" : "ja";
        await page.locator(`.languages a[lang='${alternate}']`).focus();
        await page.keyboard.press("Enter");
        const alternateUrl = new URL(localeUrl(site, basePath, alternate));
        alternateUrl.searchParams.set("platform", "copilot");
        alternateUrl.hash = viewport.name === "desktop" ? "examples" : "get-started";
        await expect(page).toHaveURL(alternateUrl.href);
        await expect(page.locator("html")).toHaveAttribute("lang", alternate);
        await expect(page.locator("#tab-copilot")).toHaveAttribute("aria-selected", "true");
        await expect(page).toHaveTitle(site[alternate].title);
        await expect(page.locator(".languages [aria-current='page']")).toHaveAttribute("lang", alternate);
        await expect(page.locator(".hero-slide img")).toHaveJSProperty("complete", true);
        await expectNoHorizontalOverflow(page);
      });
    }

    test(`${lang}: gallery keyboard selection, disclosures, and original source downloads at ${basePath}`, async ({ page, site }) => {
      await page.goto(localeUrl(site, basePath, lang));
      await expect(page.getByRole("group", { name: site[lang].galleryLabel })).toBeVisible();
      await expect(page.locator("[data-example='markdown']")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#example-markdown")).toBeVisible();
      await expect(page.locator("#example-architecture")).toBeHidden();

      for (const id of ["architecture", "markdown"]) {
        const other = id === "architecture" ? "markdown" : "architecture";
        const button = page.locator(`[data-example='${id}']`);
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(button).toBeFocused();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(button).toHaveAttribute("aria-controls", `example-${id}`);
        await expect(page.locator(`[data-example='${other}']`)).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(`#example-${id}`)).toBeVisible();
        await expect(page.locator(`#example-${other}`)).toBeHidden();
        await expect(page.locator("[data-example][aria-pressed='true']")).toHaveCount(1);

        const example = page.locator(`#example-${id}`);
        await example.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(example.locator("details")).toHaveAttribute("open", "");
        expect(await example.locator("pre code").textContent()).toBe(normalizeNewlines(site.sources[id]));
        await page.keyboard.press("Tab");
        await expect(example.locator("pre")).toBeFocused();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          example.locator("a[download]").click(),
        ]);
        expect(download.suggestedFilename()).toBe(`${id}.md`);
        expect(await download.failure()).toBeNull();
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString("utf8")).toBe(site.sources[id]);
      }
    });

    test(`${lang}: onboarding offers an AI draft, direct editing, and sharing at ${basePath}`, async ({ page, site }) => {
      await page.goto(localeUrl(site, basePath, lang));
      const copy = site[lang];
      await expect(page.locator(".needs-list > div")).toHaveCount(3);
      await expect(page.locator(".workflow-steps li")).toHaveCount(3);
      await expect(page.locator(".windows-steps > li")).toHaveCount(3);
      await expect(page.locator("#platform-windows")).toContainText(copy.desktopDescription);
      await expect(page.locator("#platform-windows")).toContainText(copy.desktopDetail);
      await expect(page.locator("#windows-install .button")).toHaveAttribute("href", site.product.storeUrl);
      await expect(page.locator("#windows-author")).toContainText(copy.windowsAuthorDescription);
      await expect(page.locator("#windows-deliver")).toContainText(copy.windowsExport);
      await expect(page.locator(".sharing")).toContainText(copy.pptxDescription);
      await page.locator("#tab-node").click();
      await expect(page.locator("#node-author")).toContainText(copy.authorPrompt);
      await expect(page.locator("#node-author")).toContainText(copy.refinePrompt);
      await expect(page.locator("#node-inspect-prompt")).toBeVisible();
      await expect(page.locator(".cli-output")).not.toHaveAttribute("open", "");
      await expect(page.locator(".cli-output")).toContainText(copy.cliCheckDescription);
      await expect(page.locator("#node-deliver")).toContainText(copy.cliDeliveryDescription);
      await expect(page.locator(".skill-setup")).not.toHaveAttribute("open", "");
      await page.locator(".skill-setup summary").click();
      await expect(page.locator(".skill-setup")).toContainText(copy.cliAlternative);
      await expect(page.locator("#cli-skill")).toHaveText(site.product.cliSkillCommand);
      await expect(page.locator("#cli-setup")).toHaveText(site.product.cliSetupCommand);
      await expect(page.locator(".alternative-command")).toHaveText(site.product.cliAlternativeCommand);
      await expect(page.locator("#cli-preview")).toHaveText(site.product.cliPreviewCommand);
      for (const step of copy.nodeExampleSteps) await expect(page.locator("#node-examples")).toContainText(step);
      await expect(page.locator(".mac-note a")).toHaveAttribute("href", site.product.macUrl);

      await page.locator(".cli-output summary").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#cli-check")).toBeVisible();
      await expect(page.locator("#cli-check")).toHaveText(site.product.cliCheckCommand);
      await expect(page.locator("#cli-command")).toHaveText(site.product.cliCommand);
      await expect(page.locator("#cli-export")).toHaveText(site.product.cliExportCommand);
      await page.keyboard.press("Tab");
      await expectVisibleFocus(page.locator("[data-copy='cli-check']"));
      await page.locator("#tab-copilot").click();
      await expect(page.locator("#copilot-author")).toContainText(copy.canvasAuthorPrompt);
      await expect(page.locator("#copilot-author")).toContainText(copy.canvasDirect);
      await expect(page.locator("#copilot-deliver")).toContainText(copy.canvasExport);
      await expect(page.locator("#canvas-open-prompt")).toHaveText(copy.canvasOpenPrompt);
      await expect(page.locator("#canvas-refine-prompt")).toHaveText(copy.canvasRefinePrompt);
      for (const id of ["windows", "node", "copilot"]) {
        await expect(page.locator(`#${id}-examples a[download][href$='.md']`))
          .toHaveAttribute("href", `${lang === "en" ? "../" : "./"}examples/service-review.md`);
      }
    });

    test(`${lang}: Windows recording decodes, seeks, loads captions, and links the original sample at ${basePath}`, async ({ page, site }) => {
      await page.goto(localeUrl(site, basePath, lang));
      const section = page.locator("#windows-workflow");
      const video = section.locator("video");
      await expect(video).toHaveAttribute("preload", "none");
      await expect(video).toHaveJSProperty("paused", true);
      await expect(video).toHaveJSProperty("autoplay", false);
      await expect(video).toHaveAttribute("width", "1920");
      await expect(video).toHaveAttribute("height", "1080");
      const posterBox = await video.boundingBox();
      const textBox = await section.locator(":scope > p").boundingBox();
      expect(posterBox.width).toBeLessThanOrEqual(textBox.width + 1);
      expect(posterBox.width / posterBox.height).toBeCloseTo(16 / 9, 2);
      await expect(video.locator("track")).toHaveCount(2);
      await expect(video.locator("track[default]")).toHaveAttribute("srclang", lang);
      await expect(section).toContainText(site[lang].recordingNote);
      await section.locator("summary").click();
      for (const step of site[lang].recordingSteps) await expect(section).toContainText(step);

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        section.locator("a[download][href$='.md']").click(),
      ]);
      expect(download.suggestedFilename()).toBe("service-review.md");
      expect(await download.failure()).toBeNull();
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString("utf8")).toBe(site.sources.windowsWorkflow);

      await video.scrollIntoViewIfNeeded();
      await video.evaluate((element) => element.play());
      await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
      const metadata = await video.evaluate((element) => ({
        duration: element.duration, width: element.videoWidth, height: element.videoHeight,
      }));
      expect(metadata.duration).toBeCloseTo(183.9, 1);
      expect(metadata.width).toBe(1920);
      expect(metadata.height).toBe(1080);
      const playbackBox = await video.boundingBox();
      expect(playbackBox.height).toBeCloseTo(posterBox.height, 1);
      for (const trackLang of ["en", "ja"]) {
        await video.evaluate((element, language) => {
          for (const track of element.textTracks) track.mode = track.language === language ? "showing" : "disabled";
        }, trackLang);
        await expect.poll(() => video.evaluate((element, language) =>
          [...element.textTracks].find((track) => track.language === language)?.cues?.length, trackLang)).toBe(42);
        const cues = await video.evaluate((element, language) =>
          [...[...element.textTracks].find((track) => track.language === language).cues].map((cue) => ({
            start: cue.startTime, end: cue.endTime, text: cue.text,
          })), trackLang);
        expect(cues.map((cue) => cue.text).join("\n")).not.toMatch(
          /customer data|credentials|production endpoints|not a recording|real application footage|loading wait omitted|顧客情報|認証情報|本番環境|実機の録画|待機を省略/iu,
        );
        for (const [index, cue] of cues.entries()) {
          expect(cue.start).toBeGreaterThanOrEqual(index ? cues[index - 1].end : 0);
          expect(cue.end).toBeGreaterThan(cue.start);
          expect(cue.end).toBeLessThanOrEqual(metadata.duration);
          expect(cue.text.split("\n").length).toBeLessThanOrEqual(2);
        }
      }
      await video.evaluate((element) => { element.pause(); element.currentTime = 167; });
      await expect.poll(() => video.evaluate((element) => !element.seeking && element.readyState >= 2)).toBe(true);
      await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeCloseTo(167, 1);
      await expect.poll(() => video.evaluate((element) =>
        [...element.textTracks].find((track) => track.mode === "showing")?.activeCues?.[0]?.text
      )).toContain("API");
      await expect(video).toHaveJSProperty("error", null);
    });
  }
}

test.describe("progressive enhancement without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const basePath of ["/", "/MarkdStage/"]) {
    for (const lang of ["ja", "en"]) {
      test(`${lang}: content, both examples, and native controls survive at ${basePath}`, async ({ page, site }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(localeUrl(site, basePath, lang));
        await expect(page.locator("h1")).toBeVisible();
        await expect(page.locator(".workflow-steps li")).toHaveCount(3);
        await expect(page.locator("#get-started")).toBeVisible();
        await expect(page.locator(".windows-steps > li")).toHaveCount(3);
        await expect(page.locator("#windows-workflow video")).toHaveAttribute("controls", "");
        await page.locator(".recording-transcript summary").click();
        await expect(page.locator(".recording-transcript li")).toHaveCount(8);
        await expect(page.locator(".gallery-controls")).toBeHidden();
        for (const button of await page.locator("[data-copy]").all()) {
          await expect(button).toHaveAttribute("hidden", "");
          await expect(button).toBeHidden();
        }
        for (const id of ["markdown", "architecture"]) {
          const example = page.locator(`#example-${id}`);
          await expect(example).toBeVisible();
          await example.locator("summary").focus();
          await page.keyboard.press("Enter");
          await expect(example.locator("pre")).toBeVisible();
          expect(await example.locator("pre code").textContent()).toBe(normalizeNewlines(site.sources[id]));
        }
        await expect(page.locator("#canvas-prompt")).toBeVisible();
        await expect(page.locator("[data-copy='canvas-prompt']")).toBeHidden();
        await expect(page.locator("#cli-setup")).toHaveText(site.product.cliSetupCommand);
        await expect(page.locator("#node-author")).toContainText(site[lang].authorPrompt);
        await expect(page.locator("#node-inspect-prompt")).toBeVisible();
        await expect(page.locator("#copilot-author")).toContainText(site[lang].canvasDirect);
        await page.locator(".cli-output summary").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#cli-export")).toBeVisible();
        await expect(page.locator("#cli-export")).toHaveText(site.product.cliExportCommand);
        await expect(page.locator("#cli-command")).toHaveText(site.product.cliCommand);
        await expectVisibleImagesLoaded(page);
        await expectNoHorizontalOverflow(page);
        await followStartLink(page);
        await expect(page.locator("#start-title")).toBeInViewport();
        const alternate = lang === "ja" ? "en" : "ja";
        await page.locator(`.languages a[lang='${alternate}']`).focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("html")).toHaveAttribute("lang", alternate);
        await expect(page.locator(".example:visible")).toHaveCount(2);
      });
    }
  }
});

for (const lang of ["ja", "en"]) {
  for (const outcome of ["success", "rejected", "unavailable"]) {
    test(`${lang}: CLI and Copilot clipboard ${outcome} is reported honestly`, async ({ page, site }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((state) => {
        window.clipboardWrites = [];
        window.legacyCopyAttempts = [];
        document.execCommand = (...args) => {
          window.legacyCopyAttempts.push(args);
          return true;
        };
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: state === "unavailable" ? undefined : {
            writeText(text) {
              window.clipboardWrites.push(text);
              return new Promise((resolve, reject) => {
                window.completeClipboard = () => state === "success"
                  ? resolve() : reject(new DOMException("Clipboard denied", "NotAllowedError"));
              });
            },
          },
        });
      }, outcome);
      await page.goto(localeUrl(site, "/MarkdStage/", lang));
      await page.locator("#tab-node").click();
      await page.locator(".skill-setup summary").click();
      await page.locator(".cli-output summary").click();
      const status = page.getByRole("status", { includeHidden: true });
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toHaveText("");
      const expectedSources = [
        ["windows-author-prompt", site[lang].authorPrompt],
        ["cli-setup", site.product.cliSetupCommand],
        ["cli-skill", site.product.cliSkillCommand],
        ["node-author-prompt", site[lang].authorPrompt],
        ["node-refine-prompt", site[lang].refinePrompt],
        ["node-inspect-prompt", site[lang].inspectPrompt],
        ["cli-preview", site.product.cliPreviewCommand],
        ["cli-check", site.product.cliCheckCommand],
        ["cli-command", site.product.cliCommand],
        ["cli-export", site.product.cliExportCommand],
        ["canvas-prompt", `${site[lang].canvasPrompt}\n\n${site.product.repository}/tree/${site.product.releaseTag}/.github/extensions/markdstage`],
        ["canvas-author-prompt", site[lang].canvasAuthorPrompt],
        ["canvas-inspect-prompt", site[lang].inspectPrompt],
        ["canvas-export-prompt", site[lang].canvasExportPrompt],
        ["canvas-open-prompt", site[lang].canvasOpenPrompt],
        ["canvas-refine-prompt", site[lang].canvasRefinePrompt],
      ];
      await expect(page.locator("[data-copy]")).toHaveCount(expectedSources.length);
      for (const [index, [id, source]] of expectedSources.entries()) {
        const button = page.locator(`[data-copy='${id}']`);
        const platform = await button.evaluate((element) => element.closest("[data-platform-panel]").dataset.platformPanel);
        await page.locator(`#tab-${platform}`).click();
        await expect(button).toBeVisible();
        expect(await page.locator(`#${id}`).textContent()).toBe(source);
        await button.focus();
        await page.keyboard.press("Enter");
        if (outcome !== "unavailable") {
          await expect(button).toBeDisabled();
          expect(await page.evaluate(() => window.clipboardWrites)).toEqual(expectedSources.slice(0, index + 1).map(([, text]) => text));
          await page.evaluate(() => window.completeClipboard());
        }
        await expect(button).toBeEnabled();
        const message = outcome === "success" ? site[lang].copied
          : outcome === "rejected" ? site[lang].copyFailed : site[lang].copyUnavailable;
        await expect(status).toHaveText(message);
        await expect(page.locator(`#${id}`)).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      expect(await page.evaluate(() => window.legacyCopyAttempts)).toEqual([]);
      if (outcome === "unavailable") expect(await page.evaluate(() => window.clipboardWrites)).toEqual([]);
    });
  }

  test(`${lang}: reduced motion disables reveal, transitions, and smooth scrolling`, async ({ page, site }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(localeUrl(site, "/MarkdStage/", lang));
    await expect(page.locator(".hero-slide")).toHaveCSS("animation-name", "stage-arrival");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
    await expect(page.locator(".hero-slide")).toHaveCSS("animation-name", "none");
    await expect(page.locator(".hero-actions .button")).toHaveCSS("transition-duration", "0s");
    await page.locator(".hero-actions .button").click();
    await expect(page.locator("#start-title")).toBeInViewport();
    await page.locator("[data-example='architecture']").click();
    await expect(page.locator("#example-architecture")).toBeVisible();
  });
}

async function audit(page, selectors = []) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  for (const selector of selectors) builder = builder.include(selector);
  const result = await builder.analyze();
  expect(result.violations.map((violation) => ({
    id: violation.id,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
  }))).toEqual([]);
}

async function expectVisibleFocus(locator) {
  await expect(locator).toBeFocused();
  await expect(locator).toHaveCSS("outline-style", "solid");
  expect(await locator.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
}

async function followStartLink(page) {
  const link = page.locator(".hero-actions .button");
  // Avoid overlapping focus and anchor scrolls, including when page JavaScript is disabled.
  await link.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await link.focus();
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
}

for (const lang of ["ja", "en"]) {
  for (const viewport of viewports.slice(0, 2)) {
    test(`${lang} ${viewport.name}: WCAG AA with focused gallery, source, and onboarding`, async ({ page, site }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(localeUrl(site, "/MarkdStage/", lang));
      await page.keyboard.press("Tab");
      await expect(page.locator(".skip-link")).toBeFocused();
      await expect(page.locator(".skip-link")).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${localeUrl(site, "/MarkdStage/", lang)}#main`);
      await audit(page);

      const selector = page.locator("[data-example='architecture']");
      await selector.focus();
      await page.keyboard.press("Enter");
      await expectVisibleFocus(selector);
      await audit(page, ["#examples"]);

      const summary = page.locator("#example-architecture summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expectVisibleFocus(page.locator("#example-architecture pre"));
      await audit(page, ["#examples"]);

      await page.locator("#tab-copilot").click();
      const prompt = page.locator("#copilot-install .prompt-box pre");
      await page.keyboard.press("Tab");
      await expectVisibleFocus(page.locator("#platform-copilot"));
      await page.keyboard.press("Tab");
      await expectVisibleFocus(prompt);
      await audit(page, ["#get-started"]);
      await page.keyboard.press("Tab");
      await expectVisibleFocus(page.locator("[data-copy='canvas-prompt']"));
      await audit(page, ["#get-started"]);
      await page.locator("#tab-node").click();
      await page.locator(".skill-setup summary").click();
      await page.locator(".cli-output summary").focus();
      await page.keyboard.press("Enter");
      await audit(page, ["#get-started"]);
    });
  }
}
