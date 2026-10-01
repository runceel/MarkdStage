// Launch an isolated VS Code instance with the in-repo MarkdStage extension
// loaded and an in-repo CLI first on PATH, so the extension never picks up an
// installed release `markdstage` (Store alias or npm global).
//
// Usage: node scripts/dev-vscode.mjs [--cli node|native] [workspace-folder]
//   --cli node    (default) packages/markdstage-cli run by the current Node.js
//   --cli native  Windows MarkdStageCli.exe built from apps/MarkdStage.Desktop

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ROOT = join(REPO_ROOT, "packages", "markdstage-cli");
const CLI_ENTRY = join(CLI_ROOT, "bin", "markdstage.mjs");
const NATIVE_CLI_PROJECT = join(REPO_ROOT, "apps", "MarkdStage.Desktop", "src", "MarkdStage.Cli", "MarkdStage.Cli.csproj");
const EXTENSION_ROOT = join(REPO_ROOT, "packages", "markdstage-vscode");
const WINDOWS = process.platform === "win32";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { cli: { type: "string", default: "node" } },
});
const variant = values.cli;
if (variant !== "node" && variant !== "native") throw new Error(`Unknown --cli value: ${variant}. Use node or native.`);
if (variant === "native" && !WINDOWS) throw new Error("--cli native requires Windows.");

// Each variant gets its own profile so both instances can run side by side;
// a shared --user-data-dir would reuse the first instance and its PATH.
const DEV_ROOT = join(REPO_ROOT, ".dev", "vscode", variant);
const BIN_DIR = join(DEV_ROOT, "bin");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function npm(script, cwd) {
  const result = spawnSync(`npm ${script}`, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`npm ${script} failed with exit code ${result.status}.`);
}

function launcherSource(target, leadingArgument) {
  const literal = (value) => `@"${value.replaceAll('"', '""')}"`;
  const prefix = leadingArgument ? `"\\"" + ${literal(leadingArgument)} + "\\" " + ` : "";
  return `using System;
using System.Diagnostics;

static class Program
{
    static int Main()
    {
        string line = Environment.CommandLine;
        int index = 0;
        if (line.Length > 0 && line[0] == '"')
        {
            index = line.IndexOf('"', 1);
            index = index < 0 ? line.Length : index + 1;
        }
        else
        {
            while (index < line.Length && line[index] != ' ' && line[index] != '\\t') index++;
        }
        string rest = line.Substring(index).TrimStart();
        Console.CancelKeyPress += (sender, e) => { e.Cancel = true; };
        var info = new ProcessStartInfo(${literal(target)}, ${prefix}rest) { UseShellExecute = false };
        using (var child = Process.Start(info))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
`;
}

// Node's spawn without a shell only resolves .com/.exe on Windows, so the
// shim must be a real executable rather than a .cmd file.
async function writeWindowsLauncher(target, leadingArgument) {
  const source = launcherSource(target, leadingArgument);
  const sourcePath = join(BIN_DIR, "markdstage.cs");
  const exePath = join(BIN_DIR, "markdstage.exe");
  if (existsSync(exePath) && existsSync(sourcePath) && (await readFile(sourcePath, "utf8")) === source) return;
  const csc = join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!existsSync(csc)) throw new Error(`C# compiler not found at ${csc}.`);
  await writeFile(sourcePath, source);
  const result = spawnSync(csc, ["/nologo", "/target:exe", `/out:${exePath}`, sourcePath], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Failed to compile the markdstage.exe dev launcher.");
}

async function writePosixLauncher() {
  const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
  const shimPath = join(BIN_DIR, "markdstage");
  await writeFile(shimPath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(CLI_ENTRY)} "$@"\n`);
  await chmod(shimPath, 0o755);
}

async function buildNativeCli() {
  const platform = process.arch === "arm64" ? "ARM64" : "x64";
  const rid = process.arch === "arm64" ? "win-arm64" : "win-x64";
  console.log(`Building native MarkdStage CLI (${rid})...`);
  run("dotnet", ["build", NATIVE_CLI_PROJECT, "-c", "Debug", "-r", rid, `-p:Platform=${platform}`, "-nologo", "-v", "q"], REPO_ROOT);
  const framework = /<TargetFramework>([^<]+)<\/TargetFramework>/.exec(await readFile(NATIVE_CLI_PROJECT, "utf8"))?.[1];
  const exe = join(dirname(NATIVE_CLI_PROJECT), "bin", platform, "Debug", framework ?? "", rid, "MarkdStageCli.exe");
  if (!existsSync(exe)) throw new Error(`Native CLI build output not found at ${exe}.`);
  return exe;
}

function withCliOnPath(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: `${BIN_DIR}${delimiter}${env[key] ?? ""}` };
}

const workspace = resolve(positionals[0] ?? REPO_ROOT);

if (!existsSync(join(EXTENSION_ROOT, "node_modules"))) {
  console.log("Installing VS Code extension dependencies...");
  npm("ci", EXTENSION_ROOT);
}
console.log("Building VS Code extension...");
npm("run build", EXTENSION_ROOT);

await mkdir(BIN_DIR, { recursive: true });
if (variant === "native") {
  await writeWindowsLauncher(await buildNativeCli());
} else {
  console.log("Syncing MarkdStage CLI shared sources...");
  run(process.execPath, [join(CLI_ROOT, "scripts", "sync-shared.mjs")], CLI_ROOT);
  await (WINDOWS ? writeWindowsLauncher(process.execPath, CLI_ENTRY) : writePosixLauncher());
}

const env = withCliOnPath(process.env);
const check = spawnSync("markdstage", ["--version"], { env, encoding: "utf8" });
if (check.status !== 0) {
  throw new Error(`Dev CLI launcher failed: ${check.stderr || check.error?.message || "unknown error"}`);
}
console.log(`Using in-repo ${variant} MarkdStage CLI ${check.stdout.trim()} via ${BIN_DIR}`);

const codeArgs = [
  "--new-window",
  "--wait",
  // The isolated profile starts with no trusted folders; Restricted Mode would
  // block every CLI-backed command in the dev instance.
  "--disable-workspace-trust",
  `--user-data-dir=${join(DEV_ROOT, "user-data")}`,
  `--extensions-dir=${join(DEV_ROOT, "extensions")}`,
  `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
  workspace,
];
const code = process.env.MARKDSTAGE_VSCODE ?? "code";
console.log(`Launching VS Code for ${workspace}`);
const child = WINDOWS
  ? spawn(`"${code}" ${codeArgs.map((arg) => `"${arg}"`).join(" ")}`, { env, stdio: "inherit", shell: true })
  : spawn(code, codeArgs, { env, stdio: "inherit" });
child.once("exit", (exitCode) => {
  process.exitCode = exitCode ?? 0;
});
