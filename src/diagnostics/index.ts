export type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticPhase,
  DiagnosticEdit,
  DiagnosticQuickFix,
  DiagnosticContextEntry,
  DiagnosticRelated,
  DiagnosticCounts,
} from './types';
export { DiagnosticError, diagError } from './errors';
export { CATALOG, KNOWN_MIPS32_NOT_IMPLEMENTED, type CatalogEntry } from './catalog';
export {
  assembleWithDiagnostics,
  diagnosticsFromAsmError,
  genericDiagnostic,
  runtimeDiagnostic,
  executionLimitDiagnostic,
  invalidInputDiagnostic,
  analyzeSource,
  countDiagnostics,
  summarize,
  applyQuickFix,
  planQuickFix,
  offsetOf,
  locateToken,
  locateMnemonic,
  closestMatch,
  lineText,
  type AssembleResult,
  type QuickFixPlan,
} from './engine';
