export interface CliInfo {
  executable: string;
  version: string;
  /** Set when the CLI is older than the extension but still compatible. */
  warning?: string;
}

export interface ReadyEvent {
  type: "ready";
  url: string;
  operation: "preview" | "present";
  workspace: string;
  sourceMode: "live" | "snapshot";
  version: string;
}

export interface ArchitectureEditorEvent {
  type: "architecture-editor";
  previewUrl: string;
  url: string;
  version: string;
}

export interface ExportEvent {
  type: "export";
  previewUrl: string;
  format: "pdf" | "pptx";
  /** Absolute path of the saved file inside the session workspace. */
  path: string;
  version: string;
}

export interface JsonProcessResult<T> {
  exitCode: number;
  stdout: string;
  stderr: string;
  value: T;
}

export interface SkillFile {
  target: string;
  path: string;
  status: "unchanged" | "created" | "updated" | "conflict";
}

export interface SkillReport {
  action: "install" | "check";
  targets: string[];
  files: SkillFile[];
  changed: number;
  conflicts: number;
}

export interface ValidationIssue {
  code?: string;
  message?: string;
  severity?: "error" | "warning" | "info";
  page?: number;
  openLine?: number;
  closeLine?: number | null;
  endLine?: number;
  lineBasis?: "visible-markdown-body" | "slide-fragment";
  bodyStartLine?: number;
}

export interface ValidationReport {
  ok: boolean;
  valid?: boolean;
  complete?: boolean;
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  diagnostics?: ValidationIssue[];
}
