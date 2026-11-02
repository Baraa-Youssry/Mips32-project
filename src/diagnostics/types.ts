export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export type DiagnosticPhase =
  | 'lexer'
  | 'parser'
  | 'assembler'
  | 'instruction'
  | 'memory'
  | 'runtime'
  | 'syscall'
  | 'system';

export interface DiagnosticEdit {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  insert: string;
  before?: string;
}

export interface DiagnosticQuickFix {
  title: string;
  edits: DiagnosticEdit[];
}

export interface DiagnosticContextEntry {
  label: string;
  value: string;
}

export interface DiagnosticRelated {
  message: string;
  line?: number;
  column?: number;
}

export interface Diagnostic {
  id: string;
  code: string;
  severity: DiagnosticSeverity;
  phase: DiagnosticPhase;
  title: string;
  message: string;
  explanation: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  actual?: string;
  expected?: string[];
  suggestion?: string;
  example?: { before?: string; after?: string };
  relatedInformation?: DiagnosticRelated[];
  context?: DiagnosticContextEntry[];
  quickFix?: DiagnosticQuickFix;
  technicalDetail?: string;
}

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
}
