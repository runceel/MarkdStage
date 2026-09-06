// Shared browser application for the top-level, preview, and present commands.

import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  MarkdStageError,
  buildPresenterBrowserArgs,
  findChromiumBrowser,
  isProcessRunning,
  terminateProcessTree,
} from "../runtime.mjs";
import { withDeckServer } from "../deck.mjs";

export async function applicationCommand(options, io, dependencies = {}) {
  const createTempDirectory = dependencies.mkdtemp ?? mkdtemp;
  const findBrowser = dependencies.findChromiumBrowser ?? findChromiumBrowser;
  const processIsRunning = dependencies.isProcessRunning ?? isProcessRunning;
  const remove = dependencies.rm ?? rm;
  const spawnBrowser = dependencies.spawn ?? spawn;
  const terminate = dependencies.terminateProcessTree ?? terminateProcessTree;
  let audienceProcess = null;
  let audienceProfileDir = "";
  let audienceUrl = "";
  let audienceOperation = Promise.resolve();

  const runAudienceOperation = (operation) => {
    const result = audienceOperation.then(operation, operation);
    audienceOperation = result.catch(() => {});
    return result;
  };

  const closeAudienceNow = async () => {
    const process = audienceProcess;
    const profileDir = audienceProfileDir;
    audienceProcess = null;
    audienceProfileDir = "";
    if (processIsRunning(process)) await terminate(process);
    if (profileDir) {
      await remove(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    return { stopped: Boolean(process) };
  };

  const closeAudience = () => runAudienceOperation(closeAudienceNow);

  const audience = {
    isRunning: () => processIsRunning(audienceProcess),
    open: () => runAudienceOperation(async () => {
      if (processIsRunning(audienceProcess)) return { alreadyRunning: true };
      await closeAudienceNow();
      const browser = findBrowser();
      if (!browser) {
        throw new MarkdStageError(
          "presenter_browser_not_found",
          "Opening the audience view requires Microsoft Edge, Google Chrome, or Chromium.",
        );
      }
      const profileDir = await createTempDirectory(
        join(tmpdir(), "markdstage-audience-window-"),
      );
      const process = spawnBrowser(
        browser,
        buildPresenterBrowserArgs({
          profileDir,
          presenterUrl: audienceUrl,
        }),
        { windowsHide: false, stdio: "ignore" },
      );
      try {
        await new Promise((ready, reject) => {
          process.once("spawn", ready);
          process.once("error", reject);
        });
      } catch (error) {
        if (processIsRunning(process)) await terminate(process);
        await remove(profileDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      audienceProcess = process;
      audienceProfileDir = profileDir;
      return { alreadyRunning: false };
    }),
    close: closeAudience,
  };

  try {
    return await withDeckServer(
      {
        ...options,
        application: true,
        initialSourceMode: options.live || options.watch ? "live" : "snapshot",
        presenter: audience,
      },
      async (session, server) => {
        const url = new URL(server.url);
        url.searchParams.set("present", "1");
        audienceUrl = url.href;

        let browserProcess = null;
        let profileDir = "";
        const browserUrl = new URL(server.url);
        if (options.presenterView) browserUrl.searchParams.set("presenter", "1");
        try {
          if (options.open) {
            const browser = findBrowser();
            if (!browser) {
              throw new MarkdStageError(
                "presenter_browser_not_found",
                "Opening MarkdStage requires Microsoft Edge, Google Chrome, or Chromium. Re-run with --no-open to serve the UI only.",
              );
            }
            profileDir = await createTempDirectory(join(tmpdir(), "markdstage-app-window-"));
            browserProcess = spawnBrowser(
              browser,
              buildPresenterBrowserArgs({ profileDir, presenterUrl: browserUrl.href }),
              { windowsHide: false, stdio: "ignore" },
            );
            await new Promise((ready, reject) => {
              browserProcess.once("spawn", ready);
              browserProcess.once("error", reject);
            });
          }

          const operation = options.presenterView
            ? "presenting"
            : session.file
              ? "previewing"
              : "ready in";
          io.print(`MarkdStage is ${operation} ${session.sourceName || "the workspace"}`);
          io.print(`  slides:    ${session.slides.length}`);
          io.print(`  theme:     ${session.theme}`);
          io.print(`  workspace: ${resolve(session.workspaceRoot)}`);
          io.print(`  url:       ${browserUrl.href}`);
          if ((options.live || options.watch) && session.file) {
            io.print("  watching:  on (live reload is enabled)");
          }
          io.print("Press Ctrl+C to stop.");

          await new Promise((done) => {
            const stop = () => {
              process.off("SIGINT", stop);
              process.off("SIGTERM", stop);
              done();
            };
            process.once("SIGINT", stop);
            process.once("SIGTERM", stop);
            if (browserProcess) browserProcess.once("close", stop);
            if (options.until) options.until.then(stop, stop);
          });

          return {
            ok: true,
            url: browserUrl.href,
            total: session.slides.length,
            theme: session.theme,
            sourceMode: server.sourceMode,
          };
        } finally {
          await closeAudience();
          if (processIsRunning(browserProcess)) await terminate(browserProcess);
          if (profileDir) {
            await remove(profileDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      },
    );
  } finally {
    await closeAudience();
  }
}
