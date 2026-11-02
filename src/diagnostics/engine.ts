import {
  assemble,
  AsmError,
  stripComment,
  SUPPORTED_INSTRUCTIONS,
  SUPPORTED_DIRECTIVES,
  instructionArity,
} from '../core/assembler';
import { MipsCpu, REGISTER_NAMES, registerIndex } from '../core/cpu';
import type { Program } from '../core/types';
import { DiagnosticError } from './errors';
import { CATALOG, KNOWN_MIPS32_NOT_IMPLEMENTED } from './catalog';
import type {
  Diagnostic,
  DiagnosticContextEntry,
  DiagnosticCounts,
  DiagnosticQuickFix,
} from './types';

interface Span {
  column: number;
  endColumn: number;
}

interface Match {
  code: string;
  token?: string;
  actual?: string;
  expected?: string[];
}

let idSeq = 0;
const nextId = (code: string, line?: number) => `${code}:${line ?? '-'}:${++idSeq}`;

const isWordChar = (ch: string) => /[\w.$]/.test(ch);

export function lineText(source: string, line: number): string {
  return source.split(/\r?\n/)[line - 1] ?? '';
}

export function offsetOf(source: string, line: number, column: number): number {
  let off = 0;
  let ln = 1;
  while (ln < line) {
    const idx = source.indexOf('\n', off);
    if (idx === -1) return source.length;
    off = idx + 1;
    ln++;
  }
  const nl = source.indexOf('\n', off);
  const end = nl === -1 ? source.length : nl;
  const col = Math.min(Math.max(1, column), Math.max(1, end - off + 1));
  return off + col - 1;
}

export function locateToken(source: string, line: number, token: string, occurrence = 1): Span | undefined {
  const raw = lineText(source, line);
  if (!raw || !token) return undefined;
  const text = stripComment(raw);
  const find = (ci: boolean): number => {
    const hay = ci ? text.toLowerCase() : text;
    const needle = ci ? token.toLowerCase() : token;
    let idx = -1;
    let count = 0;
    for (;;) {
      idx = hay.indexOf(needle, idx + 1);
      if (idx === -1) return -1;
      const before = idx > 0 ? hay[idx - 1] : '';
      const after = idx + needle.length < hay.length ? hay[idx + needle.length] : '';
      if ((!before || !isWordChar(before)) && (!after || !isWordChar(after)) && ++count >= occurrence) return idx;
    }
  };
  let idx = find(false);
  if (idx === -1) idx = find(true);
  if (idx === -1) return undefined;
  return { column: idx + 1, endColumn: idx + token.length + 1 };
}

export function locateMnemonic(source: string, line: number): Span | undefined {
  const text = stripComment(lineText(source, line));
  const m = text.match(/^(\s*(?:[A-Za-z_.$][\w.$]*\s*:\s*)*)([A-Za-z_.$][\w.$]*)/);
  if (!m) return undefined;
  return { column: m[1].length + 1, endColumn: m[1].length + m[2].length + 1 };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length];
}

export function closestMatch(word: string, candidates: Iterable<string>, maxDistance?: number): string | null {
  const w = word.toLowerCase();
  const cap = maxDistance ?? (w.length <= 3 ? 1 : w.length <= 6 ? 2 : 3);
  if (cap <= 0) return null;
  let best: string | null = null;
  let bestD = Infinity;
  let second = Infinity;
  for (const c of candidates) {
    const d = levenshtein(w, c.toLowerCase());
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = c;
    } else if (d < second) {
      second = d;
    }
  }
  if (best !== null && bestD > 0 && bestD <= cap && (bestD < second || second === Infinity)) return best;
  return null;
}

function regMatch(token: string): Match {
  if (/^\$\d+$/.test(token)) {
    const n = Number(token.slice(1));
    return n >= 0 && n <= 31 ? { code: 'REG001', token, actual: token } : { code: 'REG003', token, actual: token };
  }
  if (!token.startsWith('$')) return { code: 'REG002', token, actual: token };
  return { code: 'REG001', token, actual: token };
}

function classifyDetail(detail: string): Match | null {
  let m: RegExpMatchArray | null;
  if ((m = detail.match(/^unsupported instruction '([^']+)'$/))) return { code: 'INS001', token: m[1] };
  if ((m = detail.match(/^(\w+) expects (\d+) operand\(s\), got (\d+)$/)))
    return { code: 'INS002', token: m[1], expected: [`${m[1]} takes exactly ${m[2]} operand(s), got ${m[3]}`] };
  if ((m = detail.match(/^jalr expects 1 or 2 operands, got (\d+)$/)))
    return { code: 'INS002', token: 'jalr', expected: ['jalr $rs  or  jalr $rd, $rs'] };
  if ((m = detail.match(/^(\w+): expected register, got '([^']*)'$/))) return regMatch(m[2]);
  if ((m = detail.match(/^unknown base register '([^']+)'$/))) return regMatch(m[1]);
  if ((m = detail.match(/^Unknown register '([^']+)'$/))) return regMatch(m[1]);
  if ((m = detail.match(/^expected integer, got '([^']*)'$/))) return { code: 'INS003', token: m[1], actual: m[1] };
  if ((m = detail.match(/^Invalid integer '([^']*)'$/))) return { code: 'INS003', token: m[1], actual: m[1] };
  if ((m = detail.match(/^immediate out of range: '([^']+)' \(expected ([^)]+)\)$/i)))
    return { code: 'INS004', token: m[1], actual: m[1], expected: [m[2]] };
  if ((m = detail.match(/^li constant out of range: '([^']+)'$/)))
    return { code: 'INS004', token: m[1], actual: m[1], expected: ['-2147483648..4294967295 for li'] };
  if ((m = detail.match(/^subi immediate out of range: '([^']+)' \(expected ([^)]+)\)$/)))
    return { code: 'INS004', token: m[1], actual: m[1], expected: [m[2]] };
  if ((m = detail.match(/^(\w+) immediate operand out of range: '([^']+)' \(expected ([^)]+)\)$/)))
    return { code: 'INS004', token: m[2], actual: m[2], expected: [m[3]] };
  if ((m = detail.match(/^shift amount out of range: '([^']+)' \(expected ([^)]+)\)$/i)))
    return { code: 'INS005', token: m[1], actual: m[1], expected: [m[2]] };
  if ((m = detail.match(/^offset out of range: '([^']+)' \(expected ([^)]+)\)$/)))
    return { code: 'INS004', token: m[1], actual: m[1], expected: [m[2]] };
  if ((m = detail.match(/^invalid memory operand '([^']+)' \(expected (.+)\)$/)))
    return { code: 'INS006', token: m[1], actual: m[1], expected: [m[2]] };
  if ((m = detail.match(/^invalid offset in '([^']+)'$/))) return { code: 'MEM004', token: m[1], actual: m[1] };
  if ((m = detail.match(/^la: expected label, got '([^']*)'$/))) return { code: 'LBL003', token: m[1], actual: m[1] };
  if ((m = detail.match(/^duplicate label '([^']+)'$/))) return { code: 'LBL002', token: m[1], actual: m[1] };
  if ((m = detail.match(/^undefined label '([^']+)'$/))) return { code: 'LBL001', token: m[1], actual: m[1] };
  if ((m = detail.match(/^jump target not word-aligned: '([^']+)'$/)))
    return { code: 'LBL004', token: m[1], actual: m[1] };
  if ((m = detail.match(/^jump target out of range: '([^']+)'$/)))
    return { code: 'LBL005', token: m[1], actual: m[1] };
  if ((m = detail.match(/^branch target out of range: '([^']+)'$/)))
    return { code: 'LBL006', token: m[1], actual: m[1] };
  if ((m = detail.match(/^unknown directive '([^']+)'$/))) return { code: 'DIR001', token: m[1] };
  if ((m = detail.match(/^(\.\w+) expects (at least one value|a string)$/)))
    return { code: 'DIR002', token: m[1], expected: [m[2]] };
  if ((m = detail.match(/^invalid data constant '([^']+)'$/)))
    return { code: 'DIR003', token: m[1], actual: m[1], expected: ['a whole number in -2147483648..4294967295, or a label'] };
  if ((m = detail.match(/^(\.\w+) is only allowed in the \.data section$/))) return { code: 'DIR004', token: m[1] };
  if ((m = detail.match(/^instruction not allowed in \.data section: '([^']*)'$/)))
    return { code: 'DIR004', token: m[1] };
  if ((m = detail.match(/^\.space size must be 0\.\.\d+, got '([^']*)'$/)))
    return { code: 'DIR005', token: '.space', actual: m[1], expected: ['a byte count of 0..1048576'] };
  if ((m = detail.match(/^\.align expects 0\.\.4, got '([^']*)'$/)))
    return { code: 'DIR005', token: '.align', actual: m[1], expected: ['an exponent of 0..4 (alignment = 2^n bytes)'] };
  if ((m = detail.match(/^expected quoted string, got (.*)$/)))
    return { code: 'LEX001', actual: m[1] || '(nothing)', expected: ['a "quoted string"'] };
  if ((m = detail.match(/^unknown escape sequence '\\(.)'$/)))
    return { code: 'LEX002', token: `\\${m[1]}`, expected: [`\\n \\t \\r \\0 \\b \\f \\\\ \\" \\'`] };
  if (/^cannot parse instruction$/.test(detail)) return { code: 'LEX004' };
  if ((m = detail.match(/^cannot parse directive '(.+)'$/))) return { code: 'LEX005', token: m[1] };
  if ((m = detail.match(/^(\w+): expected register operands, or one register and one immediate \(got '([^']*)', '([^']*)'\)$/)))
    return { code: 'INS002', token: m[1], actual: `got '${m[2]}', '${m[3]}'` };
  if (/^division by zero$/.test(detail)) return { code: 'RT001' };
  if ((m = detail.match(/^Unsupported MARS syscall code (-?\d+)$/))) return { code: 'SYS001', actual: m[1] };
  if (/^String is not null-terminated within 4096 bytes$/.test(detail)) return { code: 'SYS002' };
  if ((m = detail.match(/^invalid read-string buffer size: \$a1 = (-?\d+)/)))
    return { code: 'SYS003', actual: m[1] };
  if ((m = detail.match(/^Unaligned (word|halfword) access at (0x[0-9a-f]+)$/)))
    return { code: m[1] === 'word' ? 'MEM001' : 'MEM002', actual: m[2] };
  if ((m = detail.match(/^address out of bounds: (0x[0-9a-f]+) \(effective address of '([^']+)'\)$/)))
    return { code: 'MEM003', token: m[2], actual: m[1] };
  if ((m = detail.match(/^Unsupported instruction '([^']+)'$/))) return { code: 'RT003', token: m[1] };
  if ((m = detail.match(/^Execution stopped after (\d+) steps/))) return { code: 'RT002', actual: m[1] };
  return null;
}

function baseDiagnostic(code: string, message: string, file?: string, line?: number): Diagnostic {
  const entry = CATALOG[code] ?? CATALOG.GEN001;
  const d: Diagnostic = {
    id: nextId(code, line),
    code: CATALOG[code] ? code : 'GEN001',
    severity: entry.severity,
    phase: entry.phase,
    title: entry.title,
    message,
    explanation: entry.explanation,
  };
  if (file !== undefined) d.file = file;
  if (line !== undefined) d.line = line;
  if (entry.suggestion) d.suggestion = entry.suggestion;
  if (entry.example) d.example = entry.example;
  return d;
}

function tokenSpan(source: string, d: Diagnostic, m: Match | null): Span | undefined {
  if (d.line === undefined) return undefined;
  if (m?.token) {
    const span = locateToken(source, d.line, m.token);
    if (span) return span;
  }
  if (m && m.token) return undefined;
  return locateMnemonic(source, d.line);
}

function tokenFix(source: string, d: Diagnostic, insert: string, label: string): DiagnosticQuickFix | undefined {
  if (d.line === undefined || d.column === undefined || d.endColumn === undefined) return undefined;
  const text = stripComment(lineText(source, d.line));
  const before = text.slice(d.column - 1, d.endColumn - 1);
  if (!before) return undefined;
  return {
    title: label,
    edits: [{ line: d.line, column: d.column, endLine: d.line, endColumn: d.endColumn, insert, before }],
  };
}

interface LabelDef {
  name: string;
  line: number;
  column: number;
}

function scanLabels(source: string): LabelDef[] {
  const out: LabelDef[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = stripComment(lines[i]);
    let idx = text.search(/\S/);
    while (idx >= 0) {
      const m = text.slice(idx).match(/^([A-Za-z_.$][\w.$]*)\s*:/);
      if (!m) break;
      out.push({ name: m[1], line: i + 1, column: idx + 1 });
      idx += m[0].length;
      while (idx < text.length && /\s/.test(text[idx])) idx++;
      if (idx >= 0 && idx < text.length && !/\S/.test(text[idx])) idx = text.length;
    }
  }
  return out;
}

function countRefs(source: string, name: string): number {
  let refs = 0;
  for (const raw of source.split(/\r?\n/)) {
    const text = stripComment(raw);
    let from = 0;
    for (;;) {
      const idx = text.indexOf(name, from);
      if (idx === -1) break;
      from = idx + 1;
      const before = idx > 0 ? text[idx - 1] : '';
      const after = idx + name.length < text.length ? text[idx + name.length] : '';
      if (before && isWordChar(before)) continue;
      if (after && isWordChar(after)) continue;
      const isDef = text.slice(0, idx).trim() === '' && /^\s*:/.test(text.slice(idx + name.length));
      if (!isDef) refs++;
    }
  }
  return refs;
}

function maybeMissingComma(d: Diagnostic, source: string, m: Match | null): void {
  if (d.code !== 'INS002' || d.line === undefined || !m?.token) return;
  const text = stripComment(lineText(source, d.line));
  const re = /^(\s*(?:[A-Za-z_.$][\w.$]*\s*:\s*)*)([A-Za-z_.$][\w.$]*)(\s+)(.*)$/;
  const parsed = text.match(re);
  if (!parsed) return;
  const [, prefix, mnemonic, gap, rest] = parsed;
  if (rest.includes(',') || !rest.trim()) return;
  const arity = instructionArity(mnemonic);
  if (arity === undefined) return;
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length !== arity) return;
  const restStart = prefix.length + mnemonic.length + gap.length;
  const before = text.slice(restStart);
  const insert = tokens.join(', ');
  d.code = 'LEX003';
  const entry = CATALOG.LEX003;
  d.severity = entry.severity;
  d.phase = entry.phase;
  d.title = entry.title;
  d.explanation = entry.explanation;
  d.suggestion = `Separate the operands with commas: \`${mnemonic} ${insert}\``;
  d.column = restStart + 1;
  d.endColumn = text.length + 1;
  d.endLine = d.line;
  d.quickFix = {
    title: 'Insert missing commas',
    edits: [{ line: d.line, column: d.column, endLine: d.line, endColumn: d.endColumn, insert, before }],
  };
}

function enrich(d: Diagnostic, m: Match | null, source: string): void {
  const token = m?.token ?? '';
  switch (d.code) {
    case 'INS001': {
      const known = KNOWN_MIPS32_NOT_IMPLEMENTED[token];
      const near = known !== undefined ? null : closestMatch(token, SUPPORTED_INSTRUCTIONS);
      if (known !== undefined) {
        d.suggestion = `\`${token}\` is a valid MIPS32 instruction (${known}) that this IDE does not implement — the instruction itself is not invalid.`;
      } else if (near) {
        d.suggestion = `Did you mean \`${near}\`?`;
        d.quickFix = tokenFix(source, d, near, `Replace \`${token}\` with \`${near}\``);
      }
      break;
    }
    case 'INS002':
      maybeMissingComma(d, source, m);
      break;
    case 'REG001': {
      const near = closestMatch(token, REGISTER_NAMES);
      if (near) {
        d.suggestion = `Did you mean \`${near}\`?`;
        d.quickFix = tokenFix(source, d, near, `Replace \`${token}\` with \`${near}\``);
      }
      break;
    }
    case 'REG002': {
      const withDollar = `$${token}`;
      const numeric = /^\d+$/.test(token);
      const isKnownReg =
        numeric || REGISTER_NAMES.some((r) => r.toLowerCase() === withDollar.toLowerCase());
      if (isKnownReg) {
        d.suggestion = `Register operands need a $ — did you mean \`${withDollar}\`?`;
        d.quickFix = tokenFix(source, d, withDollar, `Replace \`${token}\` with \`${withDollar}\``);
      } else {
        d.suggestion = `If \`${token}\` is meant to be a register, prefix it with $ (e.g. \`${withDollar}\`); otherwise this operand was read as a label or number.`;
      }
      break;
    }
    case 'LBL001': {
      const names = scanLabels(source).map((l) => l.name);
      const near = closestMatch(token, names);
      if (near) {
        d.suggestion = `Did you mean \`${near}\`?`;
        d.quickFix = tokenFix(source, d, near, `Replace \`${token}\` with \`${near}\``);
      }
      break;
    }
    case 'DIR001': {
      const near = closestMatch(token, SUPPORTED_DIRECTIVES);
      if (near) {
        d.suggestion = `Did you mean \`${near}\`?`;
        d.quickFix = tokenFix(source, d, near, `Replace \`${token}\` with \`${near}\``);
      }
      break;
    }
    case 'LBL002':
      d.suggestion = `Rename this or the other \`${token}\` definition so each label is unique.`;
      break;
    default:
      break;
  }
}

export function diagnosticsFromAsmError(err: AsmError, source: string): Diagnostic {
  const m = classifyDetail(err.detail);
  const code = m?.code ?? 'GEN001';
  const d = baseDiagnostic(code, err.detail, err.filename, err.line);
  if (m?.actual !== undefined) d.actual = m.actual;
  if (m?.expected) d.expected = m.expected;
  const span = tokenSpan(source, d, m);
  if (span) {
    d.column = span.column;
    d.endColumn = span.endColumn;
    d.endLine = d.line;
  }
  if (code === 'GEN001') d.technicalDetail = err.message;
  enrich(d, m, source);
  return d;
}

export function genericDiagnostic(e: unknown, filename?: string): Diagnostic {
  const d = baseDiagnostic('GEN001', 'The assembler hit an unexpected internal error.', filename);
  d.technicalDetail = e instanceof Error ? e.message : String(e);
  return d;
}

function hex(n: number): string {
  return `0x${(n >>> 0).toString(16).padStart(8, '0')}`;
}

function lineAtPc(cpu: MipsCpu, pc: number): number | undefined {
  const prog = cpu.program;
  if (!prog || prog.instructions.length === 0) return undefined;
  const delta = (pc - prog.textBase) | 0;
  if (delta < 0 || delta % 4 !== 0) return undefined;
  const ins = prog.instructions[delta / 4];
  return ins?.line;
}

function instructionArgs(instruction?: string): string[] {
  if (!instruction) return [];
  const rest = instruction.slice(instruction.indexOf(' ') + 1).trim();
  return rest ? rest.split(',').map((s) => s.trim()) : [];
}

function buildContext(code: string, cpu: MipsCpu, de: DiagnosticError | null): DiagnosticContextEntry[] {
  const ctx: DiagnosticContextEntry[] = [];
  const pc = de?.pc ?? cpu.pc;
  ctx.push({ label: 'PC', value: hex(pc) });
  const pushRegs = (names: string[]) => {
    for (const n of names) {
      try {
        const i = registerIndex(n);
        const v = cpu.registers[i];
        ctx.push({ label: REGISTER_NAMES[i] ?? `$${i}`, value: `${v} (${hex(v)})` });
      } catch {
        ctx.push({ label: n, value: '(invalid)' });
      }
    }
  };
  if (code === 'RT001') {
    pushRegs(instructionArgs(de?.instruction).slice(0, 2));
  } else if (code === 'MEM001' || code === 'MEM002' || code === 'MEM003' || code === 'MEM004') {
    const operand = de?.instruction?.match(/\(([^)]*)\)/)?.[1];
    const offsetMatch = de?.instruction?.match(/(\S+)\s*\(/);
    if (operand) {
      pushRegs([operand]);
      const off = Number(offsetMatch?.[1]);
      if (Number.isInteger(off)) {
        const base = (() => {
          try {
            return cpu.registers[registerIndex(operand)];
          } catch {
            return 0;
          }
        })();
        const addr = (base + off) | 0;
        ctx.push({ label: 'Offset', value: String(off) });
        ctx.push({ label: 'Effective address', value: hex(addr) });
      }
    }
  } else if (code === 'SYS001' || code === 'SYS002' || code === 'SYS003') {
    pushRegs(['$v0', '$a0', '$a1', '$a2']);
  } else if (code === 'RT002') {
    ctx.push({ label: 'Steps', value: String(cpu.steps) });
  }
  return ctx;
}

export function runtimeDiagnostic(e: unknown, cpu: MipsCpu, source: string, filename?: string): Diagnostic {
  const msg = e instanceof Error ? e.message : String(e);
  const de = e instanceof DiagnosticError ? e : null;
  const stripped = msg.replace(/^Line \d+: /, '');
  let cm = classifyDetail(stripped);
  if (!cm && de?.code && CATALOG[de.code]) cm = { code: de.code };
  const code = cm?.code ?? 'GEN001';
  const line = de?.line ?? (code === 'RT002' ? lineAtPc(cpu, cpu.pc) : undefined);
  const d = baseDiagnostic(code, stripped, filename, line);
  if (cm?.actual !== undefined) d.actual = cm.actual;
  if (cm?.expected) d.expected = cm.expected;
  if (d.line !== undefined) {
    const span = cm?.token ? locateToken(source, d.line, cm.token) : undefined;
    const finalSpan = span ?? locateMnemonic(source, d.line);
    if (finalSpan) {
      d.column = finalSpan.column;
      d.endColumn = finalSpan.endColumn;
      d.endLine = d.line;
    }
  }
  d.context = buildContext(code, cpu, de);
  if (de?.instruction) d.relatedInformation = [{ message: `Executing: ${de.instruction}`, line: de.line }];
  if (code === 'GEN001') d.technicalDetail = msg;
  enrich(d, cm, source);
  return d;
}

export function executionLimitDiagnostic(cpu: MipsCpu, limit: number, source: string, filename?: string): Diagnostic {
  return runtimeDiagnostic(
    new DiagnosticError(`Execution stopped after ${limit} steps (possible infinite loop)`, 'RT002'),
    cpu,
    source,
    filename,
  );
}

export function invalidInputDiagnostic(
  kind: 'int' | 'char' | 'string',
  raw: string,
  cpu: MipsCpu,
  source: string,
  filename?: string,
): Diagnostic {
  const labels: Record<string, string> = { int: 'read-int', char: 'read-char', string: 'read-string' };
  const line = lineAtPc(cpu, cpu.pc);
  const d = baseDiagnostic('SYS004', `Invalid ${labels[kind]} input: '${raw}'`, filename, line);
  d.actual = raw === '' ? '(empty)' : raw;
  d.expected =
    kind === 'int'
      ? ['a whole number in -2147483648..2147483647']
      : kind === 'char'
        ? ['at least one character (the first one is used)']
        : ['any text'];
  d.context = [
    { label: 'PC', value: hex(cpu.pc) },
    { label: 'Syscall', value: kind === 'int' ? '5 (read int)' : kind === 'char' ? '12 (read char)' : '8 (read string)' },
  ];
  if (d.line !== undefined) {
    const span = locateMnemonic(source, d.line);
    if (span) {
      d.column = span.column;
      d.endColumn = span.endColumn;
      d.endLine = d.line;
    }
  }
  return d;
}

export function analyzeSource(source: string, filename?: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = source.split(/\r?\n/);
  for (const def of scanLabels(source)) {
    if (countRefs(source, def.name) === 0) {
      const d = baseDiagnostic('WRN001', `label '${def.name}' is defined but never used`, filename, def.line);
      d.column = def.column;
      d.endColumn = def.column + def.name.length;
      d.endLine = def.line;
      d.actual = def.name;
      out.push(d);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const text = stripComment(lines[i]);
    const glob = text.match(/^(\s*)(\.globl|\.global)(\s+)(\S+)/);
    if (glob) {
      const col = glob[1].length + 1;
      const d = baseDiagnostic('INF001', `${glob[2]} ${glob[4]} is accepted and ignored`, filename, i + 1);
      d.column = col;
      d.endColumn = col + glob[2].length;
      d.endLine = i + 1;
      out.push(d);
    }
    for (const token of ['$k0', '$k1']) {
      let from = 0;
      for (;;) {
        const idx = text.indexOf(token, from);
        if (idx === -1) break;
        from = idx + 1;
        const before = idx > 0 ? text[idx - 1] : '';
        const after = idx + token.length < text.length ? text[idx + token.length] : '';
        if (before && isWordChar(before)) continue;
        if (after && isWordChar(after)) continue;
        const d = baseDiagnostic('HNT001', `register ${token} is reserved for the OS kernel`, filename, i + 1);
        d.column = idx + 1;
        d.endColumn = idx + token.length + 1;
        d.endLine = i + 1;
        d.actual = token;
        out.push(d);
      }
    }
  }
  return out;
}

export interface AssembleResult {
  program?: Program;
  diagnostics: Diagnostic[];
  errorMessage?: string;
  ok: boolean;
}

export function assembleWithDiagnostics(source: string, filename?: string): AssembleResult {
  try {
    const program = assemble(source, filename);
    return { program, diagnostics: analyzeSource(source, filename), ok: true };
  } catch (e) {
    if (e instanceof AsmError) {
      return { diagnostics: [diagnosticsFromAsmError(e, source)], errorMessage: e.message, ok: false };
    }
    return { diagnostics: [genericDiagnostic(e, filename)], ok: false };
  }
}

export function countDiagnostics(diags: readonly Diagnostic[]): DiagnosticCounts {
  const counts: DiagnosticCounts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const d of diags) {
    if (d.severity === 'error') counts.errors++;
    else if (d.severity === 'warning') counts.warnings++;
    else if (d.severity === 'info') counts.infos++;
    else counts.hints++;
  }
  return counts;
}

export function summarize(diags: readonly Diagnostic[]): string {
  const c = countDiagnostics(diags);
  const parts: string[] = [];
  if (c.errors) parts.push(`${c.errors} Error${c.errors === 1 ? '' : 's'}`);
  if (c.warnings) parts.push(`${c.warnings} Warning${c.warnings === 1 ? '' : 's'}`);
  if (c.infos) parts.push(`${c.infos} Info${c.infos === 1 ? '' : 's'}`);
  if (c.hints) parts.push(`${c.hints} Hint${c.hints === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'No issues';
}

export interface QuickFixPlan {
  from: number;
  to: number;
  insert: string;
}

export function planQuickFix(source: string, fix: DiagnosticQuickFix): QuickFixPlan[] | null {
  const plans: QuickFixPlan[] = [];
  for (const e of fix.edits) {
    const from = offsetOf(source, e.line, e.column);
    const to = offsetOf(source, e.endLine, e.endColumn);
    if (to < from || to > source.length) return null;
    if (e.before !== undefined && source.slice(from, to) !== e.before) return null;
    plans.push({ from, to, insert: e.insert });
  }
  plans.sort((a, b) => b.from - a.from);
  return plans;
}

export function applyQuickFix(source: string, fix: DiagnosticQuickFix): string | null {
  const plan = planQuickFix(source, fix);
  if (!plan) return null;
  let out = source;
  for (const p of plan) out = out.slice(0, p.from) + p.insert + out.slice(p.to);
  return out;
}
