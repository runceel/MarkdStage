import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

for (const type of ["commonjs", "module"]) {
  test(`pinned Markdown lexer works in ${type} package distributions`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "markdstage-marked-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "renderer"));
    await mkdir(join(root, "vendor"));
    await writeFile(join(root, "package.json"), JSON.stringify({ type }));
    await cp(new URL("../renderer/marked-lexer.mjs", import.meta.url), join(root, "renderer", "marked-lexer.mjs"));
    await cp(new URL("../vendor/marked.min.js", import.meta.url), join(root, "vendor", "marked.min.js"));
    const { markedLexer } = await import(pathToFileURL(join(root, "renderer", "marked-lexer.mjs")));
    const tokens = markedLexer.lexer("- Parent\n  - Child\n\n    ```adaptive-card\n    {}\n    ```");
    const cards = [];
    markedLexer.walkTokens(tokens, (token) => { if (token.type === "code") cards.push(token); });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].lang, "adaptive-card");
    assert.equal(cards[0].text, "{}");
  });
}
