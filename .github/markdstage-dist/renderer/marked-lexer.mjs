import * as bundle from "../vendor/marked.min.js";

// The identical pinned UMD bytes expose CommonJS exports in an untyped Node
// package and globalThis.marked in browser/ESM packages. This is module interop,
// not host or I/O selection. Keep validation options independent of UI globals.
const library = bundle.Marked ? bundle : bundle.default ?? globalThis.marked;
if (typeof library?.Marked !== "function") throw new Error("The pinned Marked parser is unavailable.");
export const markedLexer = new library.Marked({ gfm: true, breaks: false });
