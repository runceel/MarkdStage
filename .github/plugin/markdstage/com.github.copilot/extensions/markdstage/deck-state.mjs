const DEFAULT_BACKCOVER = ["---", "layout: backcover", "---", ""].join("\n");

export const OPEN_INPUT_REQUIRES_SLIDES_MESSAGE =
  "Non-empty open input must include sourcePath (a workspace-relative Markdown file) " +
  "or slides (a non-empty array of strings for an explicit unsaved snapshot). " +
  "To refocus the current canvas, call open_canvas with no input. " +
  "To use the default editable workflow, pass sourcePath and the canvas will read " +
  "the Markdown file with automatic refresh enabled. sourceName remains metadata " +
  "for asset/theme resolution and output naming when using slides.";

function readLayout(markdown) {
  if (typeof markdown !== "string") return "";
  const text = markdown
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^[\n \t\uFEFF]+/, "");
  if (!text.startsWith("---\n")) return "";
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") break;
    const separator = lines[i].indexOf(":");
    if (separator <= 0) continue;
    if (lines[i].slice(0, separator).trim().toLowerCase() !== "layout") continue;
    return lines[i]
      .slice(separator + 1)
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .toLowerCase();
  }
  return "";
}

export function ensureBackCover(slides) {
  if (!slides.length) return slides;
  if (readLayout(slides[slides.length - 1]) === "backcover") return slides;
  return [...slides, DEFAULT_BACKCOVER];
}

function sameSlides(left, right) {
  return left.length === right.length && left.every((slide, index) => slide === right[index]);
}

function clampIndex(value, total) {
  const index = Number(value);
  if (!Number.isFinite(index) || total <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}

export function classifyOpenInput(input) {
  if (input === undefined || input === null) return { kind: "refocus" };
  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      kind: "invalid",
      message: "MarkdStage open input must be an object when provided.",
    };
  }
  if (Object.keys(input).length === 0) return { kind: "refocus" };
  const hasSlides = Object.prototype.hasOwnProperty.call(input, "slides");
  const hasSourcePath = Object.prototype.hasOwnProperty.call(input, "sourcePath");
  if (hasSlides && hasSourcePath) {
    return {
      kind: "invalid",
      message: "Pass either sourcePath or slides to open MarkdStage, not both.",
    };
  }
  if (hasSourcePath) {
    const sourcePath = input.sourcePath;
    if (typeof sourcePath !== "string" || !sourcePath.trim()) {
      return {
        kind: "invalid",
        message: "sourcePath must be a non-empty workspace-relative Markdown path.",
      };
    }
    return { kind: "source", sourcePath: sourcePath.trim().replaceAll("\\", "/") };
  }
  if (!hasSlides) {
    return { kind: "invalid", message: OPEN_INPUT_REQUIRES_SLIDES_MESSAGE };
  }
  const slides = input.slides;
  if (
    !Array.isArray(slides) ||
    slides.length === 0 ||
    !slides.every((slide) => typeof slide === "string")
  ) {
    return {
      kind: "invalid",
      message: "slides must be a non-empty array of strings when provided to open",
    };
  }
  return { kind: "deck", slides };
}

export function planDeckOpen(
  currentSlides,
  incomingSlides,
  { hasThemeInput = false, hasSourceInput = false } = {},
) {
  const normalizedCurrent = ensureBackCover(currentSlides.slice());
  const normalizedIncoming = ensureBackCover(incomingSlides.slice());
  const sameDeck = sameSlides(normalizedCurrent, normalizedIncoming);
  return {
    sameDeck,
    shouldApply:
      currentSlides.length === 0 || !sameDeck || hasThemeInput || hasSourceInput,
    preserveCurrentIndex: sameDeck,
  };
}

export function getExportSlides(inst) {
  if (inst.slides.length) {
    const slides = [...inst.slides];
    if (inst.mode === "adhoc" && typeof inst.markdown === "string") {
      slides[clampIndex(inst.index, slides.length)] = inst.markdown;
    }
    return slides;
  }
  if (inst.mode === "adhoc" && typeof inst.markdown === "string") {
    return [inst.markdown];
  }
  return [];
}

export function getOutputSnapshotSlides(inst) {
  return ensureBackCover(getExportSlides(inst));
}
