import { parseFrontMatter } from "./theme.mjs";
import { stripSpeakerNotes } from "./speaker-notes.mjs";

export function splitFrontMatter(md) {
  const meta = {};
  const text = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = text.replace(/^[\n \t\uFEFF]+/, "");
  if (!trimmed.startsWith("---\n") && trimmed !== "---") {
    return { meta, body: md };
  }
  const lines = trimmed.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return { meta, body: md };
  Object.assign(meta, parseFrontMatter(lines.slice(0, end + 1).join("\n")));
  return { meta, body: lines.slice(end + 1).join("\n") };
}

export function deriveTitle(md) {
  const { body } = splitFrontMatter(typeof md === "string" ? md : "");
  const lines = stripSpeakerNotes(body).split("\n");
  let fallback = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (heading) return trimTitle(heading[1]);
    if (!fallback) fallback = line;
  }
  return fallback ? trimTitle(fallback) : "(Untitled)";
}

function trimTitle(text) {
  const stripped = text
    .replace(/[*_`>#~]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  return stripped.length > 40 ? stripped.slice(0, 40) + "…" : stripped || "(Untitled)";
}
