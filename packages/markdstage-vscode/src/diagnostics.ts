import type { ValidationIssue, ValidationReport } from "./types.js";

export interface DiagnosticPosition {
  startLine: number;
  endLine: number;
}

export interface ProjectedDiagnostic extends DiagnosticPosition {
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

export function slideStartLines(text: string): number[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const starts: number[] = [];
  const separator = /^[ \t]{0,3}-{3,}[ \t]*$/;
  const metaLine = /^[A-Za-z][\w-]*[ \t]*:/;
  const frontMatterEnd = (start: number): number | undefined => {
    if (!separator.test(lines[start] ?? "")) return undefined;
    let entries = 0;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (separator.test(lines[index])) return entries ? index : undefined;
      if (!lines[index].trim() || /^[ \t]*#/.test(lines[index])) continue;
      if (!metaLine.test(lines[index])) return undefined;
      entries += 1;
    }
    return undefined;
  };

  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const deckFrontMatterEnd = frontMatterEnd(cursor);
  if (deckFrontMatterEnd !== undefined) cursor = deckFrontMatterEnd + 1;

  let fence: string | undefined;
  let firstBodyLine: number | undefined;
  let hasBody = false;
  let hasMeta = false;
  const flush = (fallback: number): void => {
    if (hasBody || hasMeta) starts.push(firstBodyLine ?? Math.min(fallback, Math.max(0, lines.length - 1)));
    fence = undefined;
    firstBodyLine = undefined;
    hasBody = false;
    hasMeta = false;
  };
  const includeBodyLine = (index: number): void => {
    if (!lines[index].trim()) return;
    firstBodyLine ??= index;
    hasBody = true;
  };

  for (let index = cursor; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      includeBodyLine(index);
      if (new RegExp(`^[ \\t]{0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = undefined;
      continue;
    }
    const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      fence = openingFence[1];
      includeBodyLine(index);
      continue;
    }
    if (!separator.test(line)) {
      includeBodyLine(index);
      continue;
    }
    if (hasBody && (lines[index - 1] ?? "").trim()) {
      includeBodyLine(index);
      continue;
    }
    const slideFrontMatterEnd = frontMatterEnd(index);
    if (slideFrontMatterEnd !== undefined) {
      if (hasBody || hasMeta) flush(index);
      hasMeta = true;
      index = slideFrontMatterEnd;
      continue;
    }
    flush(index + 1);
  }
  flush(lines.length - 1);
  return starts;
}

function rangeFor(issue: ValidationIssue, starts: number[], lineCount: number): DiagnosticPosition {
  const slideStart = issue.page && issue.page > 0 ? starts[issue.page - 1] ?? 0 : 0;
  const fragmentOffset = issue.lineBasis === "slide-fragment"
    ? Math.max(0, (issue.bodyStartLine ?? 1) - 1)
    : 0;
  const localStart = Math.max(1, (issue.openLine ?? issue.endLine ?? 1) - fragmentOffset);
  const localEnd = Math.max(localStart, (issue.closeLine ?? issue.endLine ?? localStart + fragmentOffset) - fragmentOffset);
  const startLine = Math.min(lineCount - 1, Math.max(0, slideStart + localStart - 1));
  const endLine = Math.min(lineCount - 1, Math.max(startLine, slideStart + localEnd - 1));
  return { startLine, endLine };
}

export function projectDiagnostics(report: ValidationReport, text: string): ProjectedDiagnostic[] {
  const starts = slideStartLines(text);
  const lineCount = Math.max(1, text.replace(/\r\n?/g, "\n").split("\n").length);
  const items: Array<ValidationIssue & { severity: "error" | "warning" | "info" }> = [
    ...(report.diagnostics ?? []).map((item) => ({
      ...item,
      severity: item.severity ?? "warning",
    })),
    ...(report.errors ?? []).map((item) => ({ ...item, severity: "error" as const })),
    ...(report.warnings ?? []).map((item) => ({ ...item, severity: "warning" as const })),
  ];
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const message = item.message?.trim();
    if (!message) return [];
    const range = rangeFor(item, starts, lineCount);
    const key = `${item.code}|${item.severity}|${range.startLine}|${range.endLine}|${message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...range, severity: item.severity, message, code: item.code }];
  });
}
