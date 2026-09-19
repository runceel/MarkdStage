import { validateArchitectureInput } from "../architecture-validation.mjs";
import { parseSlideMarkdown } from "../renderer/fenced-blocks.mjs";
import { markedLexer } from "../renderer/marked-lexer.mjs";
import { validateAdaptiveCardSource, cardDiagnostic } from "../renderer/adaptive-card-validation.mjs";

export function adaptiveCardValidationReport(slides, { file } = {}) {
  const diagnostics = [], blocks = [];
  let scannedChars = 0, truncated = false;
  for (const [slideIndex, slide] of slides.entries()) {
    scannedChars += slide.length;
    if (slideIndex >= 200 || scannedChars > 2_097_152 || blocks.length >= 200 || diagnostics.length >= 200) {
      truncated = true;
      diagnostics.push(cardDiagnostic("card-validation-incomplete", "$",
        "Card validation reached the deck inspection limit; validate smaller inputs.", "error"));
      break;
    }
    for (const block of parseSlideMarkdown(slide, markedLexer).cards) {
      if (blocks.length >= 200 || diagnostics.length >= 200) {
        truncated = true;
        diagnostics.push(cardDiagnostic("card-validation-incomplete", "$",
          "Card validation reached the block or diagnostic inspection limit; validate smaller inputs.", "error"));
        break;
      }
      const result = validateAdaptiveCardSource(block.body);
      const position = {
        ...(file ? { file } : {}), slideIndex, page: slideIndex + 1, blockIndex: block.index,
        adaptiveCard: block.index + 1, markdownPath: block.markdownPath,
        openLine: block.openLine, closeLine: block.closeLine, lineBasis: "visible-markdown-body",
      };
      const issues = [...result.diagnostics];
      if (!block.closed) issues.push(cardDiagnostic("unclosed-adaptive-card-fence", "$",
        "The adaptive-card fence is not closed. Add the matching closing fence.", "error"));
      const remaining = 200 - diagnostics.length;
      if (issues.length > remaining) {
        truncated = true;
        issues.splice(Math.max(0, remaining - 1), issues.length, cardDiagnostic("card-validation-incomplete", "$",
          "Card validation reached the diagnostic inspection limit; validate smaller inputs.", "error"));
      }
      diagnostics.push(...issues.map((entry) => ({
        ...entry, ...position, sourcePath: `adaptive-card[${block.index}]${entry.path}`,
      })));
      blocks.push({ ...position, valid: result.valid && block.closed,
        complete: result.complete, diagnosticCount: issues.length });
      truncated ||= result.truncated;
    }
  }
  return {
    valid: !truncated && blocks.every((block) => block.valid),
    complete: !truncated, truncated, diagnostics, blocks,
    resourceValidation: "deferred-to-browser",
  };
}

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
  const cards = adaptiveCardValidationReport(session.slides, { file: file ?? session.file ?? session.sourceName });
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
  for (const diagnostic of cards.diagnostics.filter((entry) => entry.severity === "error")) {
    errors.push({ code: diagnostic.code, page: diagnostic.page, adaptiveCard: diagnostic.adaptiveCard,
      path: diagnostic.path, sourcePath: diagnostic.sourcePath, impact: diagnostic.impact, message: diagnostic.message });
  }
  const diagnostics = [...validation.diagnostics, ...cards.diagnostics];
  return {
    ok: errors.length === 0 && validation.valid && cards.valid,
    valid: errors.length === 0 && validation.valid && cards.valid,
    complete: validation.complete && cards.complete,
    truncated: validation.truncated || cards.truncated,
    file: file ?? session.file ?? session.sourceName,
    workspace: workspace ?? session.workspaceRoot,
    total: session.slides.length,
    theme: session.theme,
    themeFile: session.customThemeFile || undefined,
    errors,
    warnings,
    stages: validation.stages,
    diagnostics,
    diagnosticCount: diagnostics.length,
    adaptiveCards: cards,
    blocks: validation.blocks,
    skipped: validation.skipped,
    limits: validation.limits,
    budget: validation.budget,
  };
}
