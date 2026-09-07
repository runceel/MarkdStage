// Regenerate pinned SVGs using bundled Mermaid 11.15.0, default theme, Arial.
// node test\scripts\mermaid-ishikawa-fixtures.mjs
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";

const directory = join(process.cwd(), "test", "fixtures", "mermaid");
const harness = await startHarness({ slides: ["# Ishikawa fixtures"] });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(harness.url);
  await page.waitForFunction(() => window.mermaid);
  for (const name of ["ishikawa-basic", "ishikawa-multiline", "ishikawa-hybrid", "ishikawa-handdrawn", "ishikawa-native"]) {
    const source = await readFile(join(directory, `${name}.mmd`), "utf8");
    const svg = await page.evaluate(async ({ source, name }) => {
      mermaid.initialize({ startOnLoad: false, theme: "default", fontFamily: "Arial", securityLevel: "loose" });
      return (await mermaid.render(name, source)).svg;
    }, { source, name });
    await writeFile(join(directory, `${name}.svg`), svg);
    console.log(name);
  }
} finally {
  await browser.close();
  await harness.close();
}
