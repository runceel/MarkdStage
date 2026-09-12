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
