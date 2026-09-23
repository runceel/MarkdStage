import {
  ARCHITECTURE_VALIDATION_LIMITS,
  ArchitectureValidationInputError,
  validateArchitectureInput,
} from "../architecture-validation.mjs";
import { cardDiagnostic } from "../renderer/adaptive-card-validation.mjs";
import { adaptiveCardValidationReport } from "./deck-validation.mjs";

// Keep errors ahead of warnings when trimming, but return them in source order.
function selectDiagnostics(diagnostics, maxDiagnostics) {
  const ranked = diagnostics.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.severity === "error" ? 0 : 1) - (b.entry.severity === "error" ? 0 : 1) || a.index - b.index);
  return ranked.slice(0, maxDiagnostics).sort((a, b) => a.index - b.index).map(({ entry }) => entry);
}

function boundedCardReport(slides, maxDiagnostics) {
  // Slides past the inspection limit are never read; input checks only type the inspected prefix.
  const { maxSlides } = ARCHITECTURE_VALIDATION_LIMITS;
  const report = adaptiveCardValidationReport(slides.slice(0, maxSlides));
  if (slides.length > maxSlides) {
    report.valid = false;
    report.complete = false;
    report.truncated = true;
    report.diagnostics.push(cardDiagnostic("card-validation-incomplete", "$",
      `Card validation stopped at the maxSlides inspection limit (${maxSlides}); slides after ${maxSlides} were not checked.`,
      "error"));
  }
  const omitted = report.diagnostics.length - maxDiagnostics;
  if (omitted <= 0) return { ...report, omittedDiagnostics: 0 };
  // Trimming the returned list does not leave cards unchecked, so validity and completeness stay as inspected.
  return {
    ...report,
    truncated: true,
    diagnostics: selectDiagnostics(report.diagnostics, maxDiagnostics),
    omittedDiagnostics: omitted,
  };
}

/**
 * Validate explicit, unloaded content before display. Architecture results keep
 * their existing shape; slide inputs also report Adaptive Card diagnostics, and
 * the top-level valid/complete/truncated values cover both checks.
 */
export function validateMarkdStageInput(input) {
  const report = validateArchitectureInput(input);
  if (input.format !== "slides") return report;
  const adaptiveCards = boundedCardReport(input.slides, report.limits.maxDiagnostics);
  return {
    ...report,
    valid: report.valid && adaptiveCards.valid,
    complete: report.complete && adaptiveCards.complete,
    truncated: report.truncated || adaptiveCards.truncated,
    adaptiveCards,
  };
}

export function createMarkdStageValidationTool() {
  return {
    name: "markdstage_validate",
    description:
      "Read-only preflight of explicit, unloaded Architecture DSL or one-slide Markdown fragments. Call markdstage_guide with architecture-schema BEFORE drafting DSL, then call this tool BEFORE display. Requires format 'dsl' with source OR format 'slides' with slides, never both. Slide input also validates adaptive-card fences and reports them under adaptiveCards. Does not open, inspect, navigate, or modify a canvas or file. Returns bounded canonical diagnostics; ok describes invocation, while valid/complete/truncated describe the combined content check.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["dsl", "slides"] },
        source: { type: "string", description: "Raw Architecture DSL JSON, only with format 'dsl'." },
        slides: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "One-slide Markdown fragments, only with format 'slides'; this does not split whole Markdown files.",
        },
        maxDiagnostics: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      required: ["format"],
      additionalProperties: false,
      oneOf: [
        { properties: { format: { const: "dsl" } }, required: ["source"], not: { required: ["slides"] } },
        { properties: { format: { const: "slides" } }, required: ["slides"], not: { required: ["source"] } },
      ],
    },
    handler: async (input) => {
      try {
        return {
          textResultForLlm: JSON.stringify(validateMarkdStageInput(input)),
          resultType: "success",
        };
      } catch (error) {
        if (!(error instanceof ArchitectureValidationInputError)) throw error;
        return {
          textResultForLlm: JSON.stringify({ ok: false, error: error.code, message: error.message }),
          resultType: "failure",
        };
      }
    },
  };
}
