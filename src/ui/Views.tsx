import type { MipsCpu } from '../core/cpu';
import type { Program } from '../core/types';

export function TextView({ program, pc }: { program: Program; pc: number }) {
  const list = program.instructions;
  if (list.length === 0) {
    return (
      <div className="viewscroll">
        <div className="emptyview">Nothing assembled yet — press <b>Assemble</b> (F6) to generate the listing.</div>
      </div>
    );
  }
  const off = pc - program.textBase;
  const cur = off >= 0 && off % 4 === 0 && off / 4 < list.length ? off / 4 : -1;
  return (
    <div className="viewscroll listing">
      <div className="caption">
        Internal listing after pseudo-expansion — machine-code encoding is not available in this build (no encoder
        implemented), so no opcodes are shown. Addresses are sequential byte addresses from 0x
        {program.textBase.toString(16)}.
      </div>
      {list.map((ins, i) => (
        <div className={i === cur ? 'row cur' : 'row'} key={i}>
          <span className="addr">0x{(program.textBase + i * 4).toString(16).padStart(8, '0')}</span>
          <span className="op">{ins.op}</span>
          <span className="args">{ins.args.join(', ')}</span>
          <span className="srcline">L{ins.line}</span>
          <span className="src">{ins.source}</span>
        </div>
      ))}
    </div>
  );
}

export function DataView({ cpu }: { cpu: MipsCpu }) {
  const words = cpu.memory.entries();
  if (words.length === 0) {
    return (
      <div className="viewscroll">
        <div className="emptyview">
          No memory written yet — store with <b>sw</b>/<b>sh</b>/<b>sb</b> or define .data values, then assemble.
        </div>
      </div>
    );
  }
  // Group dirty words into 16-byte rows (little-endian byte extraction).
  const rows = new Map<number, (number | undefined)[]>();
  for (const [addr, value] of words) {
    const base = addr & ~15;
    let slots = rows.get(base);
    if (!slots) {
      slots = new Array<number | undefined>(16).fill(undefined);
      rows.set(base, slots);
    }
    const within = addr - base;
    for (let b = 0; b < 4; b++) slots[within + b] = (value >>> (8 * b)) & 0xff;
  }
  const bases = [...rows.keys()].sort((a, b) => a - b);
  const asciiOf = (s: (number | undefined)[]) =>
    s.map((b) => (b === undefined ? ' ' : b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  return (
    <div className="viewscroll dataview">
      <div className="caption">
        Data segment (base 0x{cpu.program.dataBase.toString(16)}) — hex + ASCII. Sparse view: only words that have
        been written appear.
      </div>
      {bases.map((base) => {
        const s = rows.get(base)!;
        const hexs = s.map((b) => (b === undefined ? '--' : b.toString(16).padStart(2, '0'))).join(' ');
        return (
          <div className="hexrow" key={base}>
            <span className="haddr">{base.toString(16).padStart(8, '0')}</span>
            <span className="bytes">{hexs}</span>
            <span className="ascii">|{asciiOf(s)}|</span>
          </div>
        );
      })}
    </div>
  );
}
