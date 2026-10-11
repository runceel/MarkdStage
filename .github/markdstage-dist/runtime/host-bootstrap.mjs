import { createHostIO } from "./io-host.mjs";
import { createPortableRuntime } from "./portable-runtime.mjs";

// Explicit entry point: a WebView2 host supplies its bridge and publishes the
// returned object in the engine context it controls. No globals are sniffed.
export async function createHostRuntime(bridge, options = {}) {
  return createPortableRuntime({ ...options, io: createHostIO(bridge) });
}
