export function isSampleDeckPath(path) {
  return (
    path === "slides.md" ||
    path.startsWith("site/examples/") ||
    path.startsWith("docs/user-guide/examples/")
  );
}
