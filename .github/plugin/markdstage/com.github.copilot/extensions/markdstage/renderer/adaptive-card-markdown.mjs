const TAGS = ["p", "br", "strong", "b", "em", "i", "u", "s", "code", "ol", "ul", "li", "a"];

export function approvedCardHyperlink(value, documentRef) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password) return null;
    const anchor = documentRef.createElement("a");
    anchor.setAttribute("href", value);
    const clean = documentRef.defaultView.DOMPurify.sanitize(anchor.outerHTML, {
      ALLOWED_TAGS: ["a"], ALLOWED_ATTR: ["href"], RETURN_DOM_FRAGMENT: true,
    });
    return clean.firstElementChild?.getAttribute("href") === value ? value : null;
  } catch {
    return null;
  }
}

// This is the sanitized Marked fragment, not the SDK's generated DOM. Its
// formatting semantics are retained before all browser link behavior is removed.
export function prepareAdaptiveCardMarkdown(text, documentRef) {
  const { marked, DOMPurify } = documentRef.defaultView;
  const html = DOMPurify.sanitize(marked.parse(text, { breaks: true }), { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ["href"] });
  let sanitized = DOMPurify.removed.some(({ element, attribute }) =>
    attribute || (element && element.tagName !== "BODY"));
  const template = documentRef.createElement("template");
  template.innerHTML = html;
  const runs = [];
  let reason = null;
  const visit = (node, style) => {
    if (node.nodeType === 3) {
      if (node.data) runs.push({ text: node.data, ...style });
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = node.localName;
    const next = { ...style };
    if (["strong", "b"].includes(tag)) next.bold = true;
    if (["em", "i"].includes(tag)) next.italic = true;
    if (tag === "u") next.underline = true;
    if (tag === "s") next.strikethrough = true;
    if (tag === "code") next.code = true;
    if (["ol", "ul", "li"].includes(tag)) reason = "adaptive-card-markdown-list";
    if (tag === "a") {
      next.underline = true;
      const href = node.getAttribute("href");
      if (href !== null) {
        const approved = approvedCardHyperlink(href, documentRef);
        if (approved) next.href = approved;
        else sanitized = true;
      }
      node.removeAttribute("href");
    }
    if (tag === "br") runs.push({ text: "\n", ...style });
    for (const child of node.childNodes) visit(child, next);
    if (tag === "p") runs.push({ text: "\n", ...style });
  };
  visit(template.content, {});
  return { html: template.innerHTML, runs, reason, sanitized };
}
