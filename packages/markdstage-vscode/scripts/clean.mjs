import { rm } from "node:fs/promises";

await Promise.all([
  rm(new URL("../dist", import.meta.url), { recursive: true, force: true }),
  rm(new URL("../markdstage-vscode.vsix", import.meta.url), { force: true }),
]);
