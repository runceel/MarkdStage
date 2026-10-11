// Preview view modes shared by the renderer, hosts, and CLI.
//
// "scroll" stacks every slide vertically in one scrollable column; "slide"
// shows one slide at a time. Only the on-screen preview changes: presenter
// windows, capture, PDF, and PowerPoint output are always paged.
export const VIEW_MODES = Object.freeze(["scroll", "slide"]);
export const DEFAULT_VIEW_MODE = "scroll";

/** Return a supported mode, or null when `value` is not one. */
export function parseViewMode(value) {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return VIEW_MODES.includes(mode) ? mode : null;
}

export function normalizeViewMode(value, fallback = DEFAULT_VIEW_MODE) {
  return parseViewMode(value) ?? fallback;
}
