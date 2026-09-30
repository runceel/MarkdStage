// GitHub Alerts (`> [!NOTE]`) for slide bodies. Only top-level block quotes whose
// first line is exactly one supported marker become alerts, matching GitHub, so
// the same Markdown reads the same way in both places. Anything else stays a
// plain block quote.
export const ALERT_TYPES = Object.freeze({
  note: Object.freeze({ label: "Note", tone: "info" }),
  tip: Object.freeze({ label: "Tip", tone: "success" }),
  important: Object.freeze({ label: "Important", tone: "accent" }),
  warning: Object.freeze({ label: "Warning", tone: "warning" }),
  caution: Object.freeze({ label: "Caution", tone: "danger" }),
});

const MARKER_LINE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;
const MARKER_PREFIX = /^\[!(?:note|tip|important|warning|caution)\][ \t]*/i;

// Removes the marker from the first paragraph's inline tokens. Returns false,
// leaving the tokens untouched, when the marker is not a plain leading text run.
function stripMarker(paragraph) {
  const inline = paragraph.tokens;
  const first = inline?.[0];
  if (first?.type !== "text" || typeof first.text !== "string") return false;
  const prefix = MARKER_PREFIX.exec(first.text);
  if (!prefix) return false;
  const rest = first.text.slice(prefix[0].length);
  let remove = 0;
  if (rest === "") {
    remove = 1;
    // A marker ending in two or more spaces is followed by a hard break.
    if (inline[1]?.type === "br") remove = 2;
  } else if (rest.startsWith("\n")) {
    first.text = rest.slice(1);
    if (typeof first.raw === "string") first.raw = first.raw.replace(MARKER_PREFIX, "").replace(/^\n/, "");
  } else {
    return false;
  }
  inline.splice(0, remove);
  if (inline[0]?.type === "text" && typeof inline[0].text === "string") {
    inline[0].text = inline[0].text.replace(/^\n/, "");
    if (typeof inline[0].raw === "string") inline[0].raw = inline[0].raw.replace(/^\n/, "");
  }
  return true;
}

export function alertFromBlockquote(token) {
  if (token?.type !== "blockquote" || !Array.isArray(token.tokens)) return null;
  const paragraph = token.tokens[0];
  if (paragraph?.type !== "paragraph" || typeof paragraph.text !== "string") return null;
  const match = MARKER_LINE.exec(paragraph.text);
  if (!match) return null;
  const remainder = paragraph.text.slice(match[0].length);
  const hasContent = remainder.trim() !== "" ||
    token.tokens.slice(1).some((child) => child.type !== "space");
  // GitHub leaves a marker without content as literal block quote text.
  if (!hasContent) return null;
  if (!stripMarker(paragraph)) return null;
  paragraph.text = remainder;
  if (typeof paragraph.raw === "string") paragraph.raw = paragraph.raw.replace(MARKER_LINE, "");
  if (remainder.trim() === "" || paragraph.tokens.length === 0) {
    token.tokens.splice(0, token.tokens[1]?.type === "space" ? 2 : 1);
  }
  return match[1].toLowerCase();
}

// Converts eligible top-level block quotes in place and reports them in order.
export function extractAlerts(tokens) {
  const alerts = [];
  if (!Array.isArray(tokens)) return alerts;
  for (const token of tokens) {
    const type = alertFromBlockquote(token);
    if (type) alerts.push({ index: alerts.length, type, ...ALERT_TYPES[type], token });
  }
  return alerts;
}
