import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { THEME_ASSET_MAX_BYTES } from "../renderer/theme.mjs";
import { loadCustomTheme } from "../runtime/custom-theme.mjs";

test("custom theme loader validates all new background assets with the existing 2 MiB bound", async () => {
  const workspace = resolve(`.theme-background-test-${randomUUID()}`);
  const themeDir = join(workspace, "themes", "brand");
  const asset = join(themeDir, "assets", "background.png");
  try {
    await mkdir(join(themeDir, "assets"), { recursive: true });
    await writeFile(join(themeDir, "theme.css"), "--bg: #123456;");
    const background = { image: "assets/background.png" };
    for (const fields of [
      { background },
      { layouts: { default: { background } } },
      { layouts: { center: { background } } },
    ]) {
      await writeFile(join(themeDir, "theme.json"), JSON.stringify({ version: 1, ...fields }));
      await writeFile(asset, Buffer.alloc(THEME_ASSET_MAX_BYTES));
      const loaded = await loadCustomTheme(workspace, "", "themes/brand/theme.css");
      assert.deepEqual(loaded.assets, ["assets/background.png"]);
      const entry = loaded.metadata.background ??
        loaded.metadata.layouts?.default?.background ??
        loaded.metadata.layouts?.center?.background;
      assert.deepEqual(entry, { image: "/theme-assets/assets/background.png" });

      await writeFile(asset, Buffer.alloc(THEME_ASSET_MAX_BYTES + 1));
      await assert.rejects(
        loadCustomTheme(workspace, "", "themes/brand/theme.css"),
        (error) => error.code === "invalid_theme_file" && /2 MiB or smaller/.test(error.message),
      );
      await rm(asset);
      await assert.rejects(
        loadCustomTheme(workspace, "", "themes/brand/theme.css"),
        (error) => error.code === "invalid_theme_file" && /asset was not found/.test(error.message),
      );
    }
    await rm(join(themeDir, "theme.json"));
    const cssOnly = await loadCustomTheme(workspace, "", "themes/brand/theme.css");
    assert.equal(cssOnly.metadata, null);
    assert.deepEqual(cssOnly.assets, []);
    assert.equal(cssOnly.css, "--bg:#123456;");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
