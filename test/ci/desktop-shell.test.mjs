import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopApp = new URL(
  "../../apps/MarkdStage.Desktop/src/MarkdStage.App/",
  import.meta.url,
);

test("root Escape accelerator does not generate an automatic tooltip", async () => {
  const xaml = await readFile(new URL("MainWindow.xaml", desktopApp), "utf8");

  assert.match(
    xaml,
    /<Grid\s+KeyboardAcceleratorPlacementMode="Hidden">/,
  );
  assert.match(
    xaml,
    /<Grid\.KeyboardAccelerators>[\s\S]*?<KeyboardAccelerator Key="Escape"/,
  );
  assert.match(
    xaml,
    /ToolTipService\.ToolTip="Back to the file list \(Esc\)"/,
  );
});
