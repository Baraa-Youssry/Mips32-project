import { StreamLanguage } from '@codemirror/language';

const instructions = new Set(['add','addu','addi','addiu','sub','subu','subi','mult','multu','mul','div','divu','mfhi','mflo','mthi','mtlo','and','or','xor','nor','andi','ori','xori','lui','sll','srl','sra','sllv','srlv','srav','slt','sltu','slti','sltiu','li','move','la','nop','not','neg','syscall','lb','lbu','lh','lhu','lw','sb','sh','sw','beq','bne','blez','bgtz','bltz','bgez','b','blt','bgt','ble','bge','j','jal','jr','jalr']);
const registers = new Set(['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','s0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra','hi','lo','pc']);
export const mipsLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.sol() && stream.match(/\s*[\w.$]+:/)) return 'labelName';
    if (stream.eatSpace()) return null;
    if (stream.match(/#.*/)) return 'comment';
    if (stream.match(/\.(?:text|data|word|asciiz|byte|space|globl|align)\b/i)) return 'meta';
    if (stream.match(/\$[\w]+/)) return registers.has(stream.current().slice(1).toLowerCase()) ? 'variableName.special' : 'variableName';
    if (stream.match(/\$\d+/)) return 'variableName.special';
    if (stream.match(/[+-]?(?:0x[\da-f]+|\d+)/i)) return 'number';
    if (stream.match(/[\w.]+/)) { const word=stream.current().toLowerCase(); if (instructions.has(word)) return 'keyword'; if (registers.has(word)) return 'variableName.special'; }
    stream.next(); return null;
  }
});
