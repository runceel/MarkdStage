import { validateArchitectureInput } from "../architecture-validation.mjs";

export function hasFrontMatter(markdown) {
  const normalized = markdown.replace(/\r\n?/g, "\n").replace(/^[\n \t\uFEFF]+/, "");
  if (!normalized.startsWith("---\n")) return false;
  return normalized.split("\n").slice(1).some((line) => line.trim() === "---");
}

export function architectureValidationReport(slides, { index, maxDiagnostics } = {}) {
  if (index !== undefined &&
      (!Number.isInteger(index) || index < 0 || index >= slides.length)) {
    throw new RangeError("index must identify a slide in the provided array.");
  }
  const report = validateArchitectureInput({
    format: "slides",
    slides: index === undefined ? slides : [slides[index]],
    ...(maxDiagnostics === undefined ? {} : { maxDiagnostics }),
  });
  if (index === undefined) return report;
  const rebase = (item) => typeof item.slideIndex === "number"
    ? { ...item, slideIndex: item.slideIndex + index, page: item.page + index }
    : item;
  return {
    ...report,
    scope: "slide",
    index,
    page: index + 1,
    total: slides.length,
    diagnostics: report.diagnostics.map(rebase),
    blocks: report.blocks.map(rebase),
    skipped: report.skipped.map(rebase),
  };
}

function architectureError(slideIndex, blockIndex, code, message) {
  return {
    slideIndex,
    page: slideIndex + 1,
    blockIndex,
    architecture: blockIndex + 1,
    code,
    message,
  };
}

export function architectureValidationErrors(slides, { index, validation } = {}) {
  if (Array.isArray(slides) && slides.length === 0 && index === undefined && !validation) return [];
  const report = validation ?? architectureValidationReport(slides, { index });
  const errors = [];
  for (const block of report.blocks) {
    if (!block.dslValid) {
      const primary = report.diagnostics
        .slice(block.diagnosticStart, block.diagnosticStart + block.diagnosticCount)
        .find((diagnostic) => diagnostic.severity === "error");
      if (primary) {
        errors.push(architectureError(
          block.slideIndex, block.blockIndex, "invalid_architecture", primary.message,
        ));
      }
    }
    if (block.closed === false) {
      errors.push(architectureError(
        block.slideIndex, block.blockIndex, "unclosed_architecture_fence",
        "The architecture code fence is not closed. Add ``` at the end.",
      ));
    }
  }
  return errors;
}

export function validateLoadedDeck(session, { file, workspace } = {}) {
  const errors = [];
  const warnings = [];
  const validation = architectureValidationReport(session.slides);
  for (const issue of architectureValidationErrors(session.slides, { validation })) {
    errors.push({
      code: issue.code,
      page: issue.page,
      architecture: issue.architecture,
      message: issue.message,
    });
  }
  if (validation.truncated) {
    errors.push({
      code: "validation_incomplete",
      message: `Architecture validation reached inspection limits (${validation.budget.limitsReached.join(", ")}). Validate smaller inputs before treating the deck as valid.`,
    });
  }
  for (const warning of session.customThemeWarnings ?? []) {
    warnings.push({ code: warning.code, message: warning.message });
  }
  session.slides.forEach((slide, index) => {
    if (!hasFrontMatter(slide)) {
      warnings.push({
        code: "missing_front_matter",
        page: index + 1,
        message:
          "Front matter is missing. Add the deck/layout/page/total/size fields to the leading --- block.",
      });
    }
  });
  return {
    ok: errors.length === 0 && validation.valid,
    valid: errors.length === 0 && validation.valid,
    complete: validation.complete,
    truncated: validation.truncated,
    file: file ?? session.file ?? session.sourceName,
    workspace: workspace ?? session.workspaceRoot,
    total: session.slides.length,
    theme: session.theme,
    themeFile: session.customThemeFile || undefined,
    errors,
    warnings,
    stages: validation.stages,
    diagnostics: validation.diagnostics,
    diagnosticCount: validation.diagnosticCount,
    blocks: validation.blocks,
    skipped: validation.skipped,
    limits: validation.limits,
    budget: validation.budget,
  };
}
