/** Parse a local slide background without rewriting the source Markdown. */
export function parseSlideBackground(value) {
  if (value === undefined) return "";
  const invalid = (reason) => {
    throw new Error(`Invalid background-image: ${reason}`);
  };
  if (typeof value !== "string" || !value.trim()) {
    invalid("expected a non-empty /assets/... image path.");
  }
  const path = value.trim().replace(/^assets\//, "/assets/");
  if (!path.startsWith("/assets/") || /[\\?#\u0000-\u001f\u007f]/.test(path)) {
    invalid("use a local /assets/... path, without URLs, query strings, or fragments.");
  }
  const segments = path.slice("/assets/".length).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) {
    invalid("the path must stay inside an assets folder.");
  }
  if (!/\.(?:svg|png|webp|jpg|jpeg)$/i.test(path)) {
    invalid("supported image formats are SVG, PNG, WebP, JPG, and JPEG.");
  }
  return path;
}
