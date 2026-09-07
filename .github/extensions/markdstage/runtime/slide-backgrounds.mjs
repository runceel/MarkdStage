import { stat } from "node:fs/promises";
import { parseSlideBackground } from "../renderer/slide-background.mjs";
import { parseFrontMatter, THEME_ASSET_MAX_BYTES } from "../renderer/theme.mjs";
import { resolveAssetFile } from "../scripts/asset-paths.mjs";
import { MarkdStageError } from "./errors.mjs";

export async function resolveSlideBackgroundFile(workspaceRoot, sourceName, value) {
  let canonical;
  try {
    canonical = parseSlideBackground(value);
  } catch (error) {
    throw new MarkdStageError("invalid_slide_background", error.message);
  }
  if (!canonical) return null;
  let file;
  try {
    file = await resolveAssetFile(workspaceRoot, sourceName, canonical.slice("/assets/".length));
  } catch (error) {
    throw new MarkdStageError("invalid_slide_background", `Invalid background-image ${canonical}: ${error.message}`);
  }
  if (!file) {
    throw new MarkdStageError("slide_background_not_found", `Background image was not found: ${canonical}`);
  }
  const info = await stat(file);
  if (!info.isFile()) {
    throw new MarkdStageError("slide_background_not_found", `Background image is not a file: ${canonical}`);
  }
  if (info.size > THEME_ASSET_MAX_BYTES) {
    throw new MarkdStageError("slide_background_too_large", `Background image must be 2 MiB or smaller: ${canonical}`);
  }
  return file;
}

export async function loadSlideBackgrounds(workspaceRoot, sourceName, slides) {
  for (let index = 0; index < slides.length; index += 1) {
    const meta = parseFrontMatter(slides[index]);
    if (!Object.hasOwn(meta, "background-image")) continue;
    try {
      await resolveSlideBackgroundFile(workspaceRoot, sourceName, meta["background-image"]);
    } catch (error) {
      throw new MarkdStageError(error.code || "invalid_slide_background", `Slide ${index + 1}: ${error.message}`);
    }
  }
}
