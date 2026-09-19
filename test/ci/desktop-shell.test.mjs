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

test("folder drops use the folder picker flow without changing Markdown drops", async () => {
  const source = await readFile(new URL("MainPage.xaml.cs", desktopApp), "utf8");
  const drop = source.match(/private async void OnDrop\([\s\S]*?\r?\n    }/)?.[0];
  const picker = source.match(/private async void OnOpenFolderClick\([\s\S]*?\r?\n    }/)?.[0];
  const enterWorkspace = source.match(/private async Task EnterWorkspaceAsync\([\s\S]*?\r?\n    }/)?.[0];

  assert.ok(drop);
  assert.ok(picker);
  assert.ok(enterWorkspace);
  assert.match(drop, /OfType<StorageFile>\(\)\.FirstOrDefault\(item => App\.IsMarkdown\(item\.Path\)\)/);
  assert.match(drop, /App\.OpenAsync\(file: file\.Path, requestingWindow: _window\)/);
  assert.match(drop, /else if \(items\.OfType<StorageFolder>\(\)\.FirstOrDefault\(\) is \{ \} folder\)/);
  assert.match(drop, /await EnterWorkspaceAsync\(folder\.Path\)/);
  assert.match(picker, /await EnterWorkspaceAsync\(root\)/);
  assert.doesNotMatch(picker, /App\.OpenAsync/);
  assert.match(enterWorkspace, /if \(WorkspaceRoot is not null\)[\s\S]*?App\.OpenAsync\(workspace: path, requestingWindow: _window\)/);
  assert.match(enterWorkspace, /BeginWorkspaceListLoad[\s\S]*?App\.OpenAsync[\s\S]*?RefreshRecents/);
});

test("native drops retain their data and report unsupported or unreadable items", async () => {
  const source = await readFile(new URL("MainPage.xaml.cs", desktopApp), "utf8");
  const drop = source.match(/private async void OnDrop\([\s\S]*?\r?\n    }/)?.[0];

  assert.ok(drop);
  assert.match(drop, /args\.Handled = true/);
  assert.match(drop, /var deferral = args\.GetDeferral\(\)[\s\S]*?await args\.DataView\.GetStorageItemsAsync\(\)/);
  assert.match(drop, /finally\s*\{\s*deferral\.Complete\(\)/);
  assert.match(drop, /ShowOpenError\("Drop a folder or a Markdown file/);
  assert.match(drop, /catch \(Exception error\) when \([\s\S]*?COMException[\s\S]*?ShowOpenError/);
});

test("workspace errors are displayed above the folder start screen", async () => {
  const xaml = await readFile(new URL("MainPage.xaml", desktopApp), "utf8");
  const startScreen = xaml.indexOf('x:Name="WorkspaceStartScreen"');
  const errors = xaml.indexOf('x:Name="PresentationErrorInfoBar"');
  const loading = xaml.indexOf('x:Name="LoadingOverlay"');

  assert.ok(startScreen >= 0);
  assert.ok(errors > startScreen);
  assert.ok(loading > errors);
});
