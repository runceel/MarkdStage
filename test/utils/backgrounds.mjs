import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDeckServer } from "../../packages/markdstage-cli/src/deck.mjs";
import {
  createOutputJob,
  createOutputSnapshot,
} from "../../.github/extensions/markdstage/runtime/output.mjs";

export const BACKGROUND_COLORS = {
  common: [51, 68, 85, 255],
  default: [16, 32, 64, 255],
  center: [32, 48, 80, 255],
  cover: [64, 80, 96, 255],
  override: [17, 34, 204, 255],
  other: [34, 187, 51, 255],
};

export function backgroundSlide(layout, background, heading = layout) {
  return [
    "---",
    `layout: ${layout}`,
    ...(background ? [`background-image: ${background}`] : []),
    "---",
    `# ${heading}`,
    "",
    "Foreground content.",
  ].join("\n");
}

export async function withBackgroundDeck(
  { slides, theme = "custom", individual = true, exporters },
  run,
) {
  const dir = await mkdtemp(join(tmpdir(), "markdstage-backgrounds-"));
  try {
    for (const folder of ["assets", join("decks", "assets"), join("theme", "assets")]) {
      await mkdir(join(dir, folder), { recursive: true });
    }
    const svg = (rgba) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72"><rect width="128" height="72" fill="rgb(${rgba.slice(0, 3).join(",")})"/></svg>`;
    for (const name of ["common", "default", "center", "cover"]) {
      await writeFile(join(dir, "theme", "assets", `${name}.svg`), svg(BACKGROUND_COLORS[name]));
    }
    for (const name of ["override", "other"]) {
      await writeFile(join(dir, "decks", "assets", `${name}.svg`), svg(BACKGROUND_COLORS[name]));
    }
    await writeFile(join(dir, "decks", "assets", "with space.svg"), svg(BACKGROUND_COLORS.override));
    await writeFile(join(dir, "decks", "assets", "100%.svg"), svg(BACKGROUND_COLORS.override));
    await writeFile(join(dir, "decks", "assets", "with%20space.svg"), svg(BACKGROUND_COLORS.other));
    // The adjacent asset must win over an identically named root asset.
    await writeFile(join(dir, "assets", "override.svg"), svg([170, 17, 0, 255]));
    await writeFile(join(dir, "assets", "root.svg"), svg(BACKGROUND_COLORS.other));
    await writeFile(join(dir, "theme", "theme.css"), [
      "--bg:#102030;--fg:#ffffff;--body:#ffffff;",
      "--cover-bg:#102030;--section-bg:#102030;--backcover-bg:#102030;",
      "--print-slide-bg:#102030;--print-cover-bg:#102030;--print-section-bg:#102030;",
    ].join("\n"));
    await writeFile(join(dir, "theme", "theme.json"), JSON.stringify({
      version: 1,
      background: { image: "assets/common.svg" },
      cover: { background: { image: "assets/cover.svg" } },
      ...(individual ? {
        layouts: {
          default: { background: { image: "assets/default.svg" } },
          center: { background: { image: "assets/center.svg" } },
        },
      } : {}),
    }));
    const file = join(dir, "decks", "slides.md");
    await writeFile(file, slides.join("\n\n---\n\n"));
    return await withDeckServer({
      file,
      workspace: dir,
      theme,
      ...(theme === "custom" ? { themeFile: "theme/theme.css" } : {}),
      application: true,
      presenter: { isRunning: () => false },
      exporters,
    }, (session, server) => run({ session, server, dir }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function openBackgroundOutput(page, session, mode, index = 0) {
  const token = `background-test-${mode}-${index}`;
  const job = createOutputJob(createOutputSnapshot(session), mode);
  session.exportJobs.set(token, job);
  await page.goto(`${session.url}?${mode}=1&token=${token}&index=${index}`, {
    waitUntil: "load",
  });
  await page.waitForFunction(
    (mode) => document.documentElement.hasAttribute(`data-${mode}-ready`) ||
      document.documentElement.hasAttribute(`data-${mode}-error`),
    mode,
  );
  if (await page.locator("html").getAttribute(`data-${mode}-error`) === "true") {
    throw new Error(job.error || `${mode} background rendering failed`);
  }
  await page.evaluate(() => document.fonts.ready);
  return job;
}

export async function pngPixel(page, png) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(image.width * 0.97), Math.floor(image.height * 0.96), 1, 1).data];
  }, png.toString("base64"));
}
