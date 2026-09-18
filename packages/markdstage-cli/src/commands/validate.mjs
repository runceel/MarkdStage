// markdstage validate — check deck structure, Architecture DSL, and themes.

import {
  MarkdStageError,
  createDeckSession,
  createUrlToken,
} from "../runtime.mjs";
import { validateLoadedDeck } from "../../shared/runtime/deck-validation.mjs";

export async function validateCommand(options) {
  const errors = [];
  const warnings = [];
  let session = null;

  try {
    session = await createDeckSession({
      file: options.file,
      workspaceRoot: options.workspace,
      theme: options.theme,
      themeFile: options.themeFile,
      assetUrlPrefix: `/${createUrlToken()}/theme-assets/`,
    });
  } catch (error) {
    if (!(error instanceof MarkdStageError)) throw error;
    errors.push({
      code: error.code,
      message: error.message,
    });
    return {
      ok: false,
      valid: false,
      complete: false,
      truncated: false,
      file: options.file,
      total: 0,
      errors,
      warnings,
      stages: { json: "skipped", structure: "skipped", semantic: "skipped", layout: "skipped" },
      diagnostics: [],
      diagnosticCount: 0,
      blocks: [],
    };
  }

  return validateLoadedDeck(session, {
    file: session.file,
    workspace: session.workspaceRoot,
  });
}

export function formatValidateReport(report) {
  const lines = [];
  lines.push(`${report.file}`);
  if (report.total) lines.push(`  slides: ${report.total}${report.theme ? `, theme: ${report.theme}` : ""}`);
  for (const error of report.errors) {
    lines.push(
      `  error  ${error.page ? `slide ${error.page}: ` : ""}${error.sourcePath ? `${error.sourcePath} ` : ""}${error.message} (${error.code})`,
    );
  }
  for (const warning of report.warnings) {
    lines.push(`  warn   ${warning.page ? `slide ${warning.page}: ` : ""}${warning.message}`);
  }
  // Architecture warnings are returned in diagnostics rather than warnings. Summarize them
  // here so the text output does not report a clean deck for content the renderer degrades.
  for (const diagnostic of (report.diagnostics ?? []).filter((item) => item.severity === "warning")) {
    lines.push(
      `  warn   ${diagnostic.page ? `slide ${diagnostic.page}: ` : ""}${diagnostic.sourcePath ? `${diagnostic.sourcePath} ` : ""}${diagnostic.message} (${diagnostic.code})`,
    );
  }
  if (report.complete === false) {
    lines.push(report.truncated
      ? "  Validation incomplete: inspection limits were reached; unchecked content is not valid."
      : "  Validation incomplete: fix the reported errors and validate again.");
  }
  if (report.adaptiveCards?.blocks?.length) lines.push("  Card resources, Markdown sanitization and SDK rendering require browser inspection; structural validation does not fetch images.");
  lines.push(report.ok ? "  OK: the deck is valid." : `  ${report.errors.length} error(s) found.`);
  return lines.join("\n");
}
