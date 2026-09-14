export function isSampleDeckPath(path) {
  const isMarkdown = /\.m(?:arkdown|d)$/i.test(path);
  return (
    path === "slides.md" ||
    (isMarkdown && (
      path.startsWith("site/examples/") ||
      path.startsWith("docs/user-guide/examples/")
    ))
  );
}
