import type { Instruction, Program, RunResult } from './types';
import { TEXT_BASE } from './types';
import { Memory } from './memory';
import { handleSyscall } from './syscalls';
import { DiagnosticError, diagError } from '../diagnostics/errors';

const REG: Record<string, number> = { zero:0, at:1, v0:2, v1:3, a0:4, a1:5, a2:6, a3:7, t0:8, t1:9, t2:10, t3:11, t4:12, t5:13, t6:14, t7:15, s0:16, s1:17, s2:18, s3:19, s4:20, s5:21, s6:22, s7:23, t8:24, t9:25, k0:26, k1:27, gp:28, sp:29, fp:30, ra:31 };
/** Register operand names with the $ prefix, in hardware order. */
export const REGISTER_NAMES: readonly string[] = Object.keys(REG).map((n) => `$${n}`);
export function registerIndex(name: string): number {
  const n = name.trim().replace(/^\$/, '').toLowerCase();
  if (/^\d+$/.test(n) && Number(n) < 32) return Number(n);
  if (n in REG) return REG[n];
  throw diagError('REG001', `Unknown register '${name}'`);
}

function toInt32(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || !Number.isFinite(n)) throw diagError('INS003', `Invalid integer '${text}'`);
  return n | 0;
}
/** 16-bit immediate field: accepts -32768..65535, returns zero-extended bits. */
function imm16(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || !Number.isFinite(n)) throw diagError('INS003', `Invalid integer '${text}'`);
  if (n < -32768 || n > 65535) throw diagError('INS004', `Immediate out of range: '${text}' (expected -32768..65535)`);
  return n & 0xffff;
}
function shamt(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || !Number.isFinite(n) || n < 0 || n > 31) throw diagError('INS005', `Shift amount out of range: '${text}' (expected 0..31)`);
  return n;
}

const MEM_OPERAND = /^\s*(-?(?:0x[0-9a-fA-F]+|\d+))\s*\(\s*(\$\w+)\s*\)\s*$/;

export type InputKind = 'int' | 'char' | 'string';

export class MipsCpu {
  readonly registers = new Int32Array(32);
  readonly memory = new Memory();
  hi = 0; lo = 0; pc = TEXT_BASE; halted = false; steps = 0;
  output: string[] = [];
  /** Set when execution pauses at an input syscall (5/8/12); PC stays on the syscall. */
  inputPending: { kind: InputKind } | null = null;
  private inputQueue: number | string | undefined;
  program: Program = { instructions: [], labels: new Map(), data: new Uint8Array(0), dataBase: 0x10010000, textBase: TEXT_BASE };
  private instrByAddr = new Map<number, Instruction>();

  /** Supplies the value for a pending input syscall and unpauses execution. */
  provideInput(value: number | string): void {
    this.inputQueue = value;
    this.inputPending = null;
  }

  load(program: Program): void {
    this.program = program;
    this.instrByAddr.clear();
    program.instructions.forEach((ins, index) => this.instrByAddr.set(program.textBase + index * 4, ins));
    this.reset();
  }
  reset(): void {
    this.registers.fill(0);
    this.registers[29] = 0x7ffffffc; // $sp: top of user stack, word-aligned
    this.registers[28] = 0x10008000; // $gp: MARS convention
    this.memory.clear();
    const { data, dataBase } = this.program;
    for (let i = 0; i < data.length; i++) this.memory.storeByte(dataBase + i, data[i]);
    this.hi = 0; this.lo = 0; this.pc = TEXT_BASE; this.halted = false; this.steps = 0; this.output = [];
    this.inputPending = null; this.inputQueue = undefined;
  }
  step(): void {
    if (this.halted || this.inputPending) return;
    const ins = this.instrByAddr.get(this.pc);
    if (!ins) { this.halted = true; return; }
    try {
      if (!this.execute(ins)) return; // paused for input
      this.registers[0] = 0;
      this.steps++;
    }
    catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const wrapped = new DiagnosticError(`Line ${ins.line}: ${detail}`, e instanceof DiagnosticError ? e.code : undefined);
      wrapped.line = ins.line;
      wrapped.pc = this.pc;
      wrapped.op = ins.op;
      wrapped.instruction = ins.args.length ? `${ins.op} ${ins.args.join(', ')}` : ins.op;
      throw wrapped;
    }
  }
  /** Executes up to maxSteps more steps without throwing on the budget limit. */
  runChunk(maxSteps: number): { pausedForInput: boolean; budgetExhausted: boolean } {
    const start = this.steps;
    while (!this.halted && !this.inputPending && this.instrByAddr.has(this.pc) && this.steps - start < maxSteps) this.step();
    if (!this.inputPending && !this.instrByAddr.has(this.pc)) this.halted = true;
    return {
      pausedForInput: this.inputPending !== null,
      budgetExhausted: this.steps - start >= maxSteps && !this.halted && !this.inputPending,
    };
  }
  run(maxSteps = 100000): RunResult {
    const chunk = this.runChunk(maxSteps);
    if (chunk.budgetExhausted) throw diagError('RT002', `Execution stopped after ${maxSteps} steps (possible infinite loop)`);
    return { output: this.output, halted: this.halted, steps: this.steps };
  }
  private effectiveAddress(operand: string): number {
    const m = operand.match(MEM_OPERAND);
    if (!m) throw diagError('MEM004', `invalid memory operand '${operand}' (expected offset($register), e.g. 0($t1))`);
    const offset = Number(m[1]);
    if (!Number.isInteger(offset)) throw diagError('MEM004', `invalid offset in '${operand}'`);
    const address = (this.registers[registerIndex(m[2])] + offset) | 0;
    const unsigned = address >>> 0;
    if (unsigned < 0x1000) {
      throw diagError('MEM003', `address out of bounds: 0x${unsigned.toString(16).padStart(8, '0')} (effective address of '${operand}')`);
    }
    return address;
  }
  /** Executes one instruction. Returns false when paused awaiting input (PC unchanged). */
  private execute(i: Instruction): boolean {
    const r = (n: string) => registerIndex(n), val = (n: string) => this.registers[r(n)] | 0;
    const dest = (n: string, v: number) => { const index = r(n); if (index !== 0) this.registers[index] = v | 0; };
    let nextPc = (this.pc + 4) | 0;
    switch (i.op) {
      // ---- arithmetic ----
      case 'add': dest(i.args[0], (val(i.args[1]) + val(i.args[2])) | 0); break;
      case 'addu': dest(i.args[0], (val(i.args[1]) + val(i.args[2])) | 0); break;
      case 'addi': dest(i.args[0], (val(i.args[1]) + toInt32(i.args[2])) | 0); break;
      case 'addiu': dest(i.args[0], (val(i.args[1]) + toInt32(i.args[2])) | 0); break;
      case 'sub': dest(i.args[0], (val(i.args[1]) - val(i.args[2])) | 0); break;
      case 'subu': dest(i.args[0], (val(i.args[1]) - val(i.args[2])) | 0); break;
      case 'mult': { const product = BigInt(val(i.args[0])) * BigInt(val(i.args[1])); this.lo = Number(BigInt.asIntN(32, product)); this.hi = Number(BigInt.asIntN(32, product >> 32n)); break; }
      case 'multu': { const product = BigInt(val(i.args[0]) >>> 0) * BigInt(val(i.args[1]) >>> 0); this.lo = Number(BigInt.asIntN(32, product)); this.hi = Number(BigInt.asIntN(32, product >> 32n)); break; }
      case 'mul': { const product = BigInt(val(i.args[1])) * BigInt(val(i.args[2])); dest(i.args[0], Number(BigInt.asIntN(32, product))); break; }
      case 'div': { const a = val(i.args[0]), b = val(i.args[1]); if (b === 0) throw diagError('RT001', 'division by zero'); this.lo = (a === -2147483648 && b === -1) ? -2147483648 : Math.trunc(a / b); this.hi = a === -2147483648 && b === -1 ? 0 : (a % b) | 0; break; }
      case 'divu': { const a = val(i.args[0]) >>> 0, b = val(i.args[1]) >>> 0; if (b === 0) throw diagError('RT001', 'division by zero'); this.lo = Math.trunc(a / b) | 0; this.hi = (a % b) | 0; break; }
      case 'mfhi': dest(i.args[0], this.hi); break;
      case 'mflo': dest(i.args[0], this.lo); break;
      case 'mthi': this.hi = val(i.args[0]); break;
      case 'mtlo': this.lo = val(i.args[0]); break;
      // ---- logical ----
      case 'and': dest(i.args[0], val(i.args[1]) & val(i.args[2])); break;
      case 'or': dest(i.args[0], val(i.args[1]) | val(i.args[2])); break;
      case 'xor': dest(i.args[0], val(i.args[1]) ^ val(i.args[2])); break;
      case 'nor': dest(i.args[0], ~(val(i.args[1]) | val(i.args[2])) | 0); break;
      case 'andi': dest(i.args[0], val(i.args[1]) & imm16(i.args[2])); break;
      case 'ori': dest(i.args[0], val(i.args[1]) | imm16(i.args[2])); break;
      case 'xori': dest(i.args[0], val(i.args[1]) ^ imm16(i.args[2])); break;
      case 'lui': dest(i.args[0], imm16(i.args[1]) << 16); break;
      // ---- shift ----
      case 'sll': dest(i.args[0], val(i.args[1]) << shamt(i.args[2])); break;
      case 'srl': dest(i.args[0], val(i.args[1]) >>> shamt(i.args[2])); break;
      case 'sra': dest(i.args[0], val(i.args[1]) >> shamt(i.args[2])); break;
      case 'sllv': dest(i.args[0], val(i.args[1]) << (val(i.args[2]) & 31)); break;
      case 'srlv': dest(i.args[0], val(i.args[1]) >>> (val(i.args[2]) & 31)); break;
      case 'srav': dest(i.args[0], val(i.args[1]) >> (val(i.args[2]) & 31)); break;
      // ---- comparison ----
      case 'slt': dest(i.args[0], val(i.args[1]) < val(i.args[2]) ? 1 : 0); break;
      case 'sltu': dest(i.args[0], (val(i.args[1]) >>> 0) < (val(i.args[2]) >>> 0) ? 1 : 0); break;
      case 'slti': dest(i.args[0], val(i.args[1]) < toInt32(i.args[2]) ? 1 : 0); break;
      case 'sltiu': dest(i.args[0], (val(i.args[1]) >>> 0) < (toInt32(i.args[2]) >>> 0) ? 1 : 0); break;
      // ---- memory ----
      case 'lw': dest(i.args[0], this.memory.loadWord(this.effectiveAddress(i.args[1]))); break;
      case 'lb': { const b = this.memory.loadByte(this.effectiveAddress(i.args[1])); dest(i.args[0], (b << 24) >> 24); break; }
      case 'lbu': dest(i.args[0], this.memory.loadByte(this.effectiveAddress(i.args[1]))); break;
      case 'lh': { const h = this.memory.loadHalf(this.effectiveAddress(i.args[1])); dest(i.args[0], (h << 16) >> 16); break; }
      case 'lhu': dest(i.args[0], this.memory.loadHalf(this.effectiveAddress(i.args[1]))); break;
      case 'sb': this.memory.storeByte(this.effectiveAddress(i.args[1]), val(i.args[0])); break;
      case 'sh': this.memory.storeHalf(this.effectiveAddress(i.args[1]), val(i.args[0])); break;
      case 'sw': this.memory.storeWord(this.effectiveAddress(i.args[1]), val(i.args[0])); break;
      // ---- control flow (no delay slots) ----
      case 'beq': if (val(i.args[0]) === val(i.args[1])) nextPc = toInt32(i.args[2]); break;
      case 'bne': if (val(i.args[0]) !== val(i.args[1])) nextPc = toInt32(i.args[2]); break;
      case 'blez': if (val(i.args[0]) <= 0) nextPc = toInt32(i.args[1]); break;
      case 'bgtz': if (val(i.args[0]) > 0) nextPc = toInt32(i.args[1]); break;
      case 'bltz': if (val(i.args[0]) < 0) nextPc = toInt32(i.args[1]); break;
      case 'bgez': if (val(i.args[0]) >= 0) nextPc = toInt32(i.args[1]); break;
      case 'j': nextPc = toInt32(i.args[0]); break;
      case 'jal': dest('$ra', (this.pc + 4) | 0); nextPc = toInt32(i.args[0]); break;
      case 'jr': nextPc = val(i.args[0]); break;
      case 'jalr': { const target = val(i.args[1]); dest(i.args[0], (this.pc + 4) | 0); nextPc = target; break; }
      // ---- pseudos executed at CPU level (assembler expansion exists for these) ----
      case 'li': dest(i.args[0], toInt32(i.args[1])); break;
      case 'move': dest(i.args[0], val(i.args[1])); break;
      case 'syscall': {
        const code = this.registers[2] | 0;
        if ((code === 5 || code === 8 || code === 12) && this.inputQueue === undefined) {
          this.inputPending = { kind: code === 8 ? 'string' : code === 12 ? 'char' : 'int' };
          return false; // PC stays on the syscall; re-executed after provideInput()
        }
        const readCString = (address: number) => {
          let s = '';
          for (let p = address; p < address + 4096; p++) {
            const byte = this.memory.loadByte(p);
            if (!byte) return s;
            s += String.fromCharCode(byte);
          }
          throw diagError('SYS002', 'String is not null-terminated within 4096 bytes');
        };
        const host = {
          readInt: () => { const v = Number(this.inputQueue); this.inputQueue = undefined; return v | 0; },
          readString: () => { const v = String(this.inputQueue ?? ''); this.inputQueue = undefined; return v; },
          readChar: () => { const v = String(this.inputQueue ?? ''); this.inputQueue = undefined; return v.charCodeAt(0) | 0; },
        };
        const result = handleSyscall(code, this.registers[4], host, readCString);
        this.inputQueue = undefined;
        if (result.text !== undefined) this.output.push(result.text);
        if (result.value !== undefined) dest('$v0', result.value);
        if (result.string !== undefined) {
          // syscall 8: write bytes + NUL into the buffer at $a0, capped by $a1 (default 4096)
          const buf = this.registers[4] >>> 0;
          const size = this.registers[5] | 0;
          if (size < 0) throw diagError('SYS003', `invalid read-string buffer size: $a1 = ${size} (expected a positive byte count)`);
          const max = size > 0 ? size : 4096;
          const bytes = Array.from(new TextEncoder().encode(result.string.slice(0, max - 1)));
          for (let b = 0; b < bytes.length; b++) this.memory.storeByte(buf + b, bytes[b]);
          this.memory.storeByte(buf + bytes.length, 0);
        }
        if (result.halt) this.halted = true;
        break;
      }
      default: throw diagError('RT003', `Unsupported instruction '${i.op}'`);
    }
    this.pc = nextPc;
    return true;
  }
}
