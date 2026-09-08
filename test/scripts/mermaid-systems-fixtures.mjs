// Regenerate pinned SVGs with bundled Mermaid 11.15.0 and full Chromium.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { startHarness } from "../harness/server.mjs";

const directory = join(process.cwd(), "test", "fixtures", "mermaid");
const harness = await startHarness({ slides: ["# Rank 18 fixtures"] });
const browser = await chromium.launch({ executablePath: chromium.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(harness.url);
  await page.waitForFunction(() => window.mermaid);
  for (const diagram of ["c4", "architecture", "eventmodeling"]) {
    for (const variant of ["basic", "hybrid"]) {
      const name = `${diagram}-${variant}`;
      const source = await readFile(join(directory, `${name}.mmd`), "utf8");
      const svg = await page.evaluate(async ({ source, name }) => {
        mermaid.initialize({ startOnLoad: false, theme: "default", fontFamily: "Arial", securityLevel: "loose" });
        const { svg } = await mermaid.render(name, source);
        const ids = new Map();
        return svg.replace(/IconifyId[\w-]+/g, (id) => {
          if (!ids.has(id)) ids.set(id, `${name}-icon-${ids.size}`);
          return ids.get(id);
        });
      }, { source, name });
      await writeFile(join(directory, `${name}.svg`), svg);
      console.log(name);
    }
  }
} finally {
  await browser.close();
  await harness.close();
}
