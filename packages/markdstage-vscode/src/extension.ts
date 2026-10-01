import * as path from "node:path";
import * as vscode from "vscode";
import { discoverCli, runCliJson } from "./cli.js";
import { projectDiagnostics } from "./diagnostics.js";
import { PreviewSessions } from "./sessions.js";
import type { CliInfo, SkillReport, ValidationReport } from "./types.js";

const STORE_URL = "https://apps.microsoft.com/detail/9N9DG772RM03";
const NPM_URL = "https://www.npmjs.com/package/@markdstage/markdstage";
const INSTALL_URL = "https://github.com/runceel/MarkdStage/blob/main/docs/user-guide/installation.md";

let cliInfo: CliInfo | undefined;
let cliError: string | undefined;
const sessions = new PreviewSessions();

function workspaceFolderFor(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
}

function currentMarkdown(): { document: vscode.TextDocument; workspace: vscode.WorkspaceFolder } {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "markdown" || document.uri.scheme !== "file") {
    throw new Error("Open a filesystem-backed Markdown file first.");
  }
  const workspace = workspaceFolderFor(document.uri);
  if (!workspace || workspace.uri.scheme !== "file") {
    throw new Error("The Markdown file must be inside a filesystem-backed workspace.");
  }
  return { document, workspace };
}

function requireTrustedWorkspace(action: string): void {
  if (!vscode.workspace.isTrusted) {
    throw new Error(`${action} requires Workspace Trust because it executes the MarkdStage CLI or writes workspace files.`);
  }
}

async function showError(error: unknown): Promise<void> {
  await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
}

async function guideCliInstallation(message: string): Promise<void> {
  const remote = Boolean(vscode.env.remoteName);
  const windows = process.platform === "win32" && !remote;
  const primary = windows ? "Open Microsoft Store" : "Open npm package";
  const choice = await vscode.window.showWarningMessage(
    `${message}${remote ? " Install the CLI in the remote extension-host environment." : ""}`,
    primary,
    "Installation guide",
  );
  if (choice === primary) {
    await vscode.env.openExternal(vscode.Uri.parse(windows ? STORE_URL : NPM_URL));
  } else if (choice === "Installation guide") {
    await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
  }
}

async function guideCliUpdate(message: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(message, "Installation guide");
  if (choice === "Installation guide") {
    await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
  }
}

async function detectCli(context: vscode.ExtensionContext, announce = false): Promise<CliInfo | undefined> {
  requireTrustedWorkspace("CLI detection");
  const configuredPath = vscode.workspace.getConfiguration("markdstage").get<string>("executablePath");
  const manifest = context.extension.packageJSON as { version: string; markdstage?: { minimumCliVersion?: string } };
  try {
    cliInfo = await discoverCli({
      configuredPath,
      expectedVersion: manifest.version,
      minimumVersion: manifest.markdstage?.minimumCliVersion,
      cwd: workspaceFolderFor()?.uri.fsPath,
    });
    cliError = undefined;
    if (cliInfo.warning) {
      void guideCliUpdate(cliInfo.warning);
    }
    if (announce) {
      await vscode.window.showInformationMessage(`MarkdStage CLI ${cliInfo.version} found at ${cliInfo.executable}.`);
    }
    return cliInfo;
  } catch (error) {
    cliInfo = undefined;
    cliError = error instanceof Error ? error.message : String(error);
    if (announce) await guideCliInstallation(cliError);
    return undefined;
  }
}

async function requireCli(context: vscode.ExtensionContext): Promise<CliInfo> {
  const discovered = cliInfo ?? await detectCli(context);
  if (!discovered) {
    const message = cliError ?? "A compatible MarkdStage CLI was not found.";
    await guideCliInstallation(message);
    throw new Error(message);
  }
  return discovered;
}

async function openPreview(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  operation: "preview" | "present",
): Promise<void> {
  requireTrustedWorkspace(`${operation === "preview" ? "Preview" : "Presentation"}`);
  const { document, workspace } = currentMarkdown();
  if (document.isDirty && !await document.save()) throw new Error("Save the Markdown file before starting MarkdStage.");
  const cli = await requireCli(context);
  const event = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Starting MarkdStage ${operation}...` },
    () => sessions.start({
      executable: cli.executable,
      operation,
      file: document.uri.fsPath,
      workspace: workspace.uri.fsPath,
      version: cli.version,
      onArchitectureEditor: (url) => {
        void (async () => {
          const editorUri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
          try {
            await vscode.commands.executeCommand("simpleBrowser.show", editorUri.toString());
          } catch {
            await vscode.env.openExternal(editorUri);
          }
        })().catch((error) => {
          output.appendLine(`Could not open the Architecture Editor: ${error instanceof Error ? error.message : String(error)}`);
          output.show(true);
        });
      },
      onStderr: (text) => output.append(text),
      onExit: (code, signal) => {
        output.appendLine(`MarkdStage ${operation} stopped (${code ?? signal ?? "unknown"}).`);
        if (typeof code === "number" && code !== 0) output.show(true);
      },
    }),
  );
  const browserUri = await vscode.env.asExternalUri(vscode.Uri.parse(event.url));
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", browserUri.toString());
  } catch {
    await vscode.env.openExternal(browserUri);
  }
}

async function validate(context: vscode.ExtensionContext, diagnostics: vscode.DiagnosticCollection): Promise<void> {
  requireTrustedWorkspace("Validation");
  const { document, workspace } = currentMarkdown();
  if (document.isDirty && !await document.save()) throw new Error("Save the Markdown file before validating it.");
  const cli = await requireCli(context);
  const result = await runCliJson<ValidationReport>(
    cli.executable,
    ["validate", document.uri.fsPath, "--workspace", workspace.uri.fsPath, "--json"],
    workspace.uri.fsPath,
  );
  const projected = projectDiagnostics(result.value, document.getText()).map((item) => {
    const severity = item.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : item.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const endLineText = document.lineAt(item.endLine).text;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(item.startLine, 0, item.endLine, endLineText.length),
      item.message,
      severity,
    );
    diagnostic.source = "MarkdStage";
    diagnostic.code = item.code;
    return diagnostic;
  });
  diagnostics.set(document.uri, projected);
  if (result.value.ok) {
    await vscode.window.showInformationMessage("MarkdStage validation passed.");
  } else {
    await vscode.window.showWarningMessage(`MarkdStage found ${projected.length} diagnostic(s).`);
  }
}

async function skillCommand(
  context: vscode.ExtensionContext,
  action: "install" | "check",
  force = false,
): Promise<SkillReport> {
  requireTrustedWorkspace(action === "install" ? "Skill installation" : "Skill check");
  const workspace = workspaceFolderFor(vscode.window.activeTextEditor?.document.uri);
  if (!workspace || workspace.uri.scheme !== "file") {
    throw new Error("Open a filesystem-backed workspace first.");
  }
  const cli = await requireCli(context);
  const args = [
    "skill",
    action,
    "--target",
    "copilot",
    "--root",
    workspace.uri.fsPath,
    "--json",
  ];
  if (force) args.push("--force");
  return (await runCliJson<SkillReport>(cli.executable, args, workspace.uri.fsPath)).value;
}

async function installSkill(context: vscode.ExtensionContext): Promise<void> {
  const workspace = workspaceFolderFor(vscode.window.activeTextEditor?.document.uri);
  if (!workspace || workspace.uri.scheme !== "file") {
    throw new Error("Open a filesystem-backed workspace first.");
  }
  let report = await skillCommand(context, "install");
  if (report.conflicts > 0) {
    const conflictPaths = report.files
      .filter((file) => file.status === "conflict")
      .map((file) => path.relative(workspace.uri.fsPath, file.path))
      .join(", ");
    const confirmation = await vscode.window.showWarningMessage(
      `${report.conflicts} locally modified Copilot Skill file(s) were not overwritten: ${conflictPaths}`,
      { modal: true },
      "Force overwrite",
    );
    if (confirmation !== "Force overwrite") return;
    report = await skillCommand(context, "install", true);
  }
  await vscode.window.showInformationMessage(
    report.changed ? `Installed ${report.changed} MarkdStage Copilot Skill file(s).` : "MarkdStage Copilot Skill is already installed.",
  );
}

async function checkSkill(context: vscode.ExtensionContext): Promise<void> {
  const report = await skillCommand(context, "check");
  if (report.changed || report.conflicts) {
    const choice = await vscode.window.showWarningMessage(
      `MarkdStage Copilot Skill is out of date (${report.changed + report.conflicts} file(s) differ).`,
      "Install",
    );
    if (choice === "Install") await installSkill(context);
  } else {
    await vscode.window.showInformationMessage("MarkdStage Copilot Skill is up to date.");
  }
}

function command(handler: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await handler();
    } catch (error) {
      await showError(error);
    }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("markdstage");
  const output = vscode.window.createOutputChannel("MarkdStage");
  context.subscriptions.push(
    diagnostics,
    output,
    vscode.commands.registerCommand("markdstage.refreshCli", command(async () => { await detectCli(context, true); })),
    vscode.commands.registerCommand("markdstage.preview", command(async () => openPreview(context, output, "preview"))),
    vscode.commands.registerCommand(
      "markdstage.editArchitecture",
      command(async () => openPreview(context, output, "preview")),
    ),
    vscode.commands.registerCommand("markdstage.present", command(async () => openPreview(context, output, "present"))),
    vscode.commands.registerCommand("markdstage.validate", command(async () => validate(context, diagnostics))),
    vscode.commands.registerCommand("markdstage.installCopilotSkill", command(async () => installSkill(context))),
    vscode.commands.registerCommand("markdstage.checkCopilotSkill", command(async () => checkSkill(context))),
    vscode.commands.registerCommand("markdstage.stopPreviewSessions", command(async () => {
      const count = await sessions.stopAll();
      await vscode.window.showInformationMessage(`Stopped ${count} MarkdStage preview session(s).`);
    })),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("markdstage.executablePath")) {
        cliInfo = undefined;
        cliError = undefined;
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void detectCli(context);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sessions.stopAll();
    }),
  );
  if (vscode.workspace.isTrusted) void detectCli(context);
}

export async function deactivate(): Promise<void> {
  await sessions.stopAll();
}
