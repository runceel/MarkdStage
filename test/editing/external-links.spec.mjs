import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import { getSlideFrame, waitForSlideReady } from "../utils/ready.mjs";

const MARKDOWN = [
  "# Links",
  "",
  "[External](https://example.com/path?x=1)",
  "",
  "[Local](./state)",
  "",
  "[Email](mailto:user@example.com)",
].join("\n");

async function withBrowserDeck(page, run, { fail = false, query = "?view=slide" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "markdstage-browser-links-"));
  const file = join(dir, "slides.md");
  await writeFile(file, MARKDOWN);
  const opened = [];
  try {
    await withDeckServer({
      file, workspace: dir, application: true,
      openExternal: async (url) => {
        if (fail) throw new Error("default browser unavailable");
        opened.push(url);
      },
    }, async (_session, server) => {
      await page.goto(`${server.url}${query}`, { waitUntil: "load" });
      const frame = await waitForSlideReady(page);
      await run({ frame, opened, server });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("CLI slide links open externally without navigating away, including presenter view", async ({ page }) => {
  for (const query of ["?view=slide", "?presenter=1"]) {
    await withBrowserDeck(page, async ({ frame, opened, server }) => {
      await frame.locator(".deck a", { hasText: "External" }).click();
      await expect.poll(() => opened).toEqual(["https://example.com/path?x=1"]);
      expect(page.url()).toBe(`${server.url}${query}`);
      await expect((await getSlideFrame(page)).locator(".deck")).toBeVisible();
    }, { query });
  }
});

test("modified clicks and local links are not handed to the default browser", async ({ page }) => {
  await withBrowserDeck(page, async ({ frame, opened, server }) => {
    await frame.locator(".deck a", { hasText: "External" }).click({ modifiers: ["Control"] });
    await expect.poll(() => opened.length).toBe(0);
    const local = frame.locator(".deck a", { hasText: "Local" });
    await expect(local).toHaveAttribute("href", "./state");
    await local.click();
    await expect.poll(() => frame.url()).toContain("/state");
    expect(opened).toEqual([]);
    expect(page.url()).toBe(`${server.url}?view=slide`);
  });
});

test("failed OS launch stays on the slide and shows an error", async ({ page }) => {
  await withBrowserDeck(page, async ({ frame, opened, server }) => {
    await frame.locator(".deck a", { hasText: "External" }).click();
    await expect(page.locator("#exportErrorStatus")).toContainText(
      "The default browser could not open this link.",
    );
    expect(opened).toEqual([]);
    expect(page.url()).toBe(`${server.url}?view=slide`);
  }, { fail: true });
});
