import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startCanvasServer } from "../harness/canvas-server.mjs";
import { cardFence, staticCard, adaptiveCardGeometry } from "../harness/adaptive-cards.mjs";
import { inspectPptxPackage } from "../../.github/extensions/markdstage/runtime/pptx-package.mjs";

test("actual Canvas HTTP host serves the pinned SDK, renders cards and exports diagnostic PPTX", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const workspace = testInfo.outputPath("canvas-workspace");
  await mkdir(join(workspace, "assets"), { recursive: true });
  await writeFile(join(workspace, "assets", "card.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#0078d4"/></svg>');
  await writeFile(join(workspace, "cards.md"), [
    "---\ndeck: Canvas card host\nlayout: default\n---\n## Canvas card host",
    cardFence(staticCard([
      { type: "TextBlock", text: "Canonical Canvas rendering" },
      { type: "Image", url: "assets/card.svg", width: "64px" },
    ])),
    "\n---\n\n## Canvas validation",
    cardFence(staticCard([{ type: "TextBlock", text: 42 }])),
  ].join("\n\n"));
  const host = await startCanvasServer(workspace);
  try {
    expect(host.validationFeedback).toContain("invalid-property");
    const sdk = await page.request.get(new URL("vendor/adaptivecards.min.js", host.url).href);
    expect(sdk.status()).toBe(200);
    expect(createHash("sha256").update(await sdk.body()).digest("hex"))
      .toBe("5e7c13f3300ae7b89b34703501e08d709fbb6635f1c6755b92495577a77344f2");
    await page.goto(host.url);
    const surface = page.frames().find((frame) => frame.url().includes("surface=1"));
    const frame = surface || await new Promise((resolve) => page.once("framenavigated", resolve));
    await expect(frame.locator(".adaptive-card-host")).toHaveAttribute("data-adaptive-card-state", "ready");
    const geometry = await frame.evaluate(adaptiveCardGeometry);
    expect(geometry[0].cards[0].diagnostics).toEqual([]);
    expect(geometry[0].cards[0].objects.map((entry) => entry.type)).toEqual(["AdaptiveCard", "TextBlock", "Image"]);
    await page.screenshot({ path: testInfo.outputPath("canvas-host.png") });
    const response = await page.request.post(new URL("export-pptx", host.url).href, {
      headers: { Origin: new URL(host.url).origin },
      data: { outputPath: "canvas-cards.pptx" },
      timeout: 120_000,
    });
    expect(response.ok()).toBe(true);
    const report = await response.json();
    expect(report.ok).toBe(true);
    expect(report.fallbacks.filter((entry) => entry.type === "adaptive-card").map((entry) => entry.reason))
      .toEqual(["adaptive-card-invalid-property"]);
    expect(report.adaptiveCards[0].nativeObjectCount).toBe(2);
    expect(report.adaptiveCards[0].conversions.filter((entry) => entry.sourceType !== "AdaptiveCard")
      .every((entry) => entry.mode === "native")).toBe(true);
    const pptx = await readFile(report.path);
    expect(inspectPptxPackage(pptx).valid).toBe(true);
    await writeFile(testInfo.outputPath("canvas-export-report.json"), JSON.stringify(report, null, 2));
    await testInfo.attach("actual-canvas-host-pptx", {
      path: report.path, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const pdfResponse = await page.request.post(new URL("export", host.url).href, {
      headers: { Origin: new URL(host.url).origin }, data: {}, timeout: 120_000,
    });
    expect(pdfResponse.ok()).toBe(true);
    const pdf = await pdfResponse.json();
    expect(pdf.adaptiveCards.map((card) => card.status)).toEqual(["ready", "error"]);
    expect(pdf.adaptiveCards[1].diagnostics[0].code).toBe("invalid-property");
    expect(pdf.adaptiveCardIssueCount).toBe(1);
    expect((await readFile(pdf.path)).subarray(0, 5).toString()).toBe("%PDF-");
    await writeFile(testInfo.outputPath("canvas-pdf-report.json"), JSON.stringify(pdf, null, 2));
  } finally { await host.close(); }
});
