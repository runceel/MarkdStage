import assert from "node:assert/strict";
import test from "node:test";
import { errorPayload, exitCodeFor, EXIT_DECK } from "../src/exit.mjs";

test("host I/O failures retain the CLI deck-error exit code", () => {
  const error = Object.assign(new Error("The workspace operation failed."), { code: "io_failed" });
  assert.equal(exitCodeFor(error), EXIT_DECK);
  assert.deepEqual(errorPayload(error), {
    ok: false, error: "io_failed", message: "The workspace operation failed.",
  });
});

test("a locked destination retains the CLI deck-error exit code", () => {
  const error = Object.assign(
    new Error("The file is open in another application. Close it and try again. (deck.pptx)"),
    { code: "file_locked" },
  );
  assert.equal(exitCodeFor(error), EXIT_DECK);
  assert.equal(errorPayload(error).error, "file_locked");
});
