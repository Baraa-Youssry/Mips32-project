export class DiagnosticError extends Error {
  readonly code?: string;
  line?: number;
  pc?: number;
  instruction?: string;
  op?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DiagnosticError';
    this.code = code;
  }
}

export function diagError(code: string, message: string): DiagnosticError {
  return new DiagnosticError(message, code);
}
