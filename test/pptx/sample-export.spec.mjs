import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { chromium, expect, test } from "@playwright/test";

import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { createOutputJob, createOutputSnapshot, exportPptx } from "../../.github/extensions/markdstage/runtime/output.mjs";
import { runPptxOutputBrowser } from "../../.github/extensions/markdstage/runtime/browser.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";
import { REPO_ROOT, startHarness } from "../harness/server.mjs";
import { readSystemsPackage } from "../utils/systems-fallback-contract.mjs";

test("root sample exports the full deck with Architecture foreground image sources beyond 8192 characters", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const output = testInfo.outputPath("sample.pptx");
  await mkdir(dirname(output), { recursive: true });
  await withDeckServer({
    file: join(REPO_ROOT, "slides.md"), workspace: REPO_ROOT, theme: "dark",
  }, async (session) => {
    let rendered;
    const result = await exportPptx(session, relative(REPO_ROOT, output), undefined, {
      findChromiumBrowser: () => chromium.executablePath(),
      runPptxOutputBrowser: async (...args) => {
        rendered = await runPptxOutputBrowser(...args);
        return rendered;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.total).toBe(session.slides.length);
    expect(rendered.model.slides).toHaveLength(session.slides.length);
    expect(rendered.model.slides[0].layout).toBe("title");
    expect(rendered.model.slides.at(-1).layout).toBe("backcover");
    expect(rendered.model.slides.filter((slide) => slide.layout === "backcover")).toHaveLength(1);
    expect(result.fallbacks.filter((fallback) => fallback.type === "architecture")).toEqual([]);

    const bytes = await readFile(output);
    const summary = inspectPptxPackage(bytes);
    expect(summary.valid).toBe(true);
    expect(summary.slideCount).toBe(session.slides.length);
    expect(summary.notesCount).toBe(rendered.model.slides.filter((slide) => slide.notes?.trim()).length);
    const files = readSystemsPackage(bytes);
    const evidence = [];
    for (const [slideIndex, slide] of rendered.model.slides.entries()) {
      const images = slide.elements.filter((element) => element.type === "image" && element.architecture);
      if (!images.length) continue;
      const slideXml = files.get(`ppt/slides/slide${slideIndex + 1}.xml`).toString("utf8");
      const relationships = files.get(`ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`).toString("utf8");
      const pictureTargets = await page.evaluate(({ slideXml, relationships }) => {
        const parser = new DOMParser();
        const slide = parser.parseFromString(slideXml, "application/xml");
        const rels = parser.parseFromString(relationships, "application/xml");
        if (slide.querySelector("parsererror") || rels.querySelector("parsererror")) {
          throw new Error("Invalid exported slide or relationship XML");
        }
        return [...slide.getElementsByTagName("p:pic")].map((picture) => {
          const id = picture.getElementsByTagName("a:blip")[0]?.getAttribute("r:embed");
          const relation = [...rels.getElementsByTagName("Relationship")]
            .find((entry) => entry.getAttribute("Id") === id);
          if (!relation?.getAttribute("Type").endsWith("/image")) throw new Error("Missing embedded image relationship");
          return relation.getAttribute("Target");
        });
      }, { slideXml, relationships });
      const pictureMedia = pictureTargets.map((target) => posix.normalize(posix.join("ppt/slides", target)));
      const expectedCounts = new Map();
      for (const image of images) {
        expect(image.src).toMatch(/^data:image\/png;base64,/);
        const source = Buffer.from(image.src.slice(image.src.indexOf(",") + 1), "base64");
        expect(source.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        const media = pictureMedia.find((name) => files.get(name)?.equals(source));
        expect(media, `slide ${slideIndex + 1}: ${image.architecture.id} embeds its actual image bytes`).toBeTruthy();
        expectedCounts.set(media, (expectedCounts.get(media) || 0) + 1);
        evidence.push({
          page: slideIndex + 1, title: slide.title, id: image.architecture.id,
          kind: image.architecture.kind, uriCharacters: image.src.length, bytes: source.length, media,
        });
      }
      for (const [media, count] of expectedCounts) {
        expect(pictureMedia.filter((name) => name === media).length).toBeGreaterThanOrEqual(count);
      }
    }
    expect(evidence.some((image) => image.kind === "icon-picture")).toBe(true);
    expect(evidence.some((image) => image.kind === "image-picture")).toBe(true);
    expect(evidence.filter((image) => image.uriCharacters > 8192).length).toBeGreaterThan(0);
    await writeFile(testInfo.outputPath("sample-images.json"), JSON.stringify({
      slideCount: summary.slideCount, notesCount: summary.notesCount, images: evidence,
    }, null, 2));

    for (const pageNumber of new Set(evidence.map((image) => image.page))) {
      const token = `sample-image-capture-${pageNumber}`;
      session.exportJobs.set(token, createOutputJob(createOutputSnapshot(session), "capture"));
      await page.goto(`${session.url}?capture=1&token=${token}&index=${pageNumber - 1}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-capture-ready") ||
        document.documentElement.hasAttribute("data-capture-error"));
      await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
      await expect(page.locator(".architecture-error")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`capture-slide-${pageNumber}.png`) });
    }
    await testInfo.attach("sample-pptx", {
      path: output, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  });
});

test("PowerPoint collection reports the slide and Architecture source path for an over-limit image", async ({ page }) => {
  const harness = await startHarness({ slides: [
    "## Valid first slide\n\nOrdinary text.",
    ["## Invalid image on slide two", "```architecture", JSON.stringify({
      version: 1,
      elements: [{ type: "node", id: "oversized-icon", x: 100, y: 100,
        width: 300, height: 150, text: "Icon", icon: "api" }],
    }), "```"].join("\n"),
  ] });
  try {
    // Inject at image resolution, leaving real scene validation and slide error reporting intact.
    await page.route("**/renderer/architecture-scene.mjs", (route) => route.fulfill({
      contentType: "text/javascript",
      body: [
        'import { architectureSnapshotToScene as original } from "./architecture-scene.mjs?diagnostic-original";',
        "export function architectureSnapshotToScene(snapshot, options) {",
        "  if (!options?.resolveImage) return original(snapshot, options);",
        "  return original(snapshot, { ...options, resolveImage(entry, kind) {",
        "    const image = options.resolveImage(entry, kind);",
        '    const src = "data:image/png;base64," + "A".repeat(4 * Math.ceil((10 * 1024 * 1024 + 1) / 3));',
        '    return typeof image === "string" ? src : { ...image, src };',
        "  } });",
        "}",
      ].join("\n"),
    }));
    await page.goto(`${harness.url}/?pptx=1&token=${harness.printToken}`, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-pptx-error", "true");
    expect(await page.evaluate(() => window.__presentationPptxModel)).toBeUndefined();
    await expect.poll(() => harness.printReports.length).toBe(1);
    expect(harness.printReports[0].status).toBe("error");
    expect(harness.printReports[0].error).toMatch(/^PowerPoint slide 2: scene\.nodes\[\d+\]\.src \([^)]*elements\[0\][^)]*\):/);
    expect(harness.printReports[0].error).toContain("limit is 10 MiB");
  } finally {
    await harness.close();
  }
});
