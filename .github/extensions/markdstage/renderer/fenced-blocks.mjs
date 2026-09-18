import { splitFrontMatter } from "./slide-title.mjs";
import { splitSpeakerNotes } from "./speaker-notes.mjs";

const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;

// Architecture source editing retains its established byte-oriented scanner.
export function findFencedBlocks(markdown, language) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const open = FENCE_OPEN.exec(lines[index]);
    if (!open) { index++; continue; }
    const [, indent, marker, info] = open;
    const closing = new RegExp(`^[ \\t]{0,3}[${marker[0]}]{${marker.length},}[ \\t]*$`);
    let end = index + 1;
    for (; end < lines.length && !closing.test(lines[end]); end++) {}
    if (info.toLowerCase() === language) blocks.push({
      index: blocks.length, open: index, end, indent,
      body: lines.slice(index + 1, end).join("\n"),
    });
    index = end + 1;
  }
  return blocks;
}

export function parseSlideMarkdown(markdown, markedApi) {
  const { meta, body: rawBody } = splitFrontMatter(markdown);
  const directive = rawBody.match(/^\s*<!--\s*slide-size\s*:\s*(auto|compact|normal|large|xlarge)\s*-->\s*/i);
  const notes = splitSpeakerNotes(directive ? rawBody.slice(directive[0].length) : rawBody);
  const body = notes.markdown.replace(/\r\n?/g, "\n");
  const tokens = markedApi.lexer(body, { gfm: true, breaks: false });
  const cards = [];
  const walk = (entries, path, offset = null) => {
    for (const [index, token] of entries.entries()) {
      const tokenPath = `${path}[${index}]`;
      const exactOffset = offset !== null && body.slice(offset, offset + token.raw.length) === token.raw ? offset : null;
      if (token.type === "code" && token.lang?.trim().split(/\s+/)[0].toLowerCase() === "adaptive-card") {
        const marker = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1];
        const closed = Boolean(marker && new RegExp(`\\n[ \\t]{0,3}[${marker[0]}]{${marker.length},}[ \\t]*\\n?$`).test(token.raw));
        const openLine = exactOffset === null ? null : body.slice(0, exactOffset).split("\n").length;
        cards.push({
          index: cards.length, body: token.text, token, markdownPath: tokenPath,
          openLine, closeLine: openLine !== null && closed
            ? openLine + token.raw.trimEnd().split("\n").length - 1 : null,
          closed,
        });
      }
      if (token.type === "list") {
        token.items.forEach((item, itemIndex) => walk(item.tokens, `${tokenPath}.items[${itemIndex}].tokens`));
      } else if (Array.isArray(token.tokens)) walk(token.tokens, `${tokenPath}.tokens`);
      if (offset !== null) offset = exactOffset === null ? null : offset + token.raw.length;
    }
  };
  walk(tokens, "tokens", 0);
  return { meta, body, notes: notes.notes, size: directive?.[1].toLowerCase() || "", tokens, cards };
}
