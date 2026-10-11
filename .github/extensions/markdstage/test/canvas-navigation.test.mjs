import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("canvas navigation accepts reveal actions and crosses slide boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "markdstage-canvas-navigation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  const sdk = `
    export class CanvasError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    export const createCanvas = declaration => ({ declaration });
    export async function joinSession(config) {
      globalThis.presentation = config.canvases[0].declaration;
      return { log: async () => {} };
    }
  `;
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    const root = ${JSON.stringify(root)};
    const sdkUrl = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)};
    registerHooks({ resolve(specifier, context, next) {
      return specifier === "@github/copilot-sdk/extension"
        ? { url: sdkUrl, shortCircuit: true } : next(specifier, context);
    }});
    await import(${JSON.stringify(new URL("../extension.mjs", import.meta.url).href)});
    const canvas = globalThis.presentation;
    const ctx = {
      sessionId: "navigation-port",
      instanceId: "deck",
      session: { workingDirectory: root },
    };
    try {
      const { url } = await canvas.open({
        ...ctx,
        input: {
          slides: [
            "# Steps\\n\\n<!-- markdstage: reveal=list-items -->\\n\\n- First\\n- Second",
            "# Next",
          ],
        },
      });
      const post = (body) => fetch(new URL("navigate", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: new URL(url).origin },
        body: JSON.stringify(body),
      });
      const state = async () => (await fetch(new URL("state", url))).json();

      assert.deepEqual(
        (({ index, revealStep, revealTotal }) => ({ index, revealStep, revealTotal }))(
          await state(),
        ),
        { index: 0, revealStep: 0, revealTotal: 2 },
      );
      assert.deepEqual(
        (({ index, revealStep, revealTotal }) => ({ index, revealStep, revealTotal }))(
          await (await fetch(new URL("state?build=next", url))).json(),
        ),
        { index: 0, revealStep: 1, revealTotal: 2 },
      );

      for (const expected of [
        { index: 0, revealStep: 1 },
        { index: 0, revealStep: 2 },
        { index: 1, revealStep: 0 },
      ]) {
        const response = await post({ action: "advance" });
        assert.equal(response.status, 200, await response.text());
        assert.deepEqual(
          (({ index, revealStep }) => ({ index, revealStep }))(await state()),
          expected,
        );
      }

      let response = await post({ action: "rewind" });
      assert.equal(response.status, 200, await response.text());
      assert.deepEqual(
        (({ index, revealStep }) => ({ index, revealStep }))(await state()),
        { index: 0, revealStep: 2 },
      );

      response = await post({ index: 0 });
      assert.equal(response.status, 200, await response.text());
      assert.equal((await state()).revealStep, 0);

      for (const body of [
        { action: "advance", index: 1 },
        { action: "invalid" },
      ]) {
        response = await post(body);
        assert.equal(response.status, 400);
        assert.equal(
          (await response.json()).error,
          "exactly one of index, delta, or a reveal action is required",
        );
      }
    } finally {
      await canvas.onClose(ctx);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
