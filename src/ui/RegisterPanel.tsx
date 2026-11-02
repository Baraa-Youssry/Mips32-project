import { useState } from 'react';
import type { MipsCpu } from '../core/cpu';

const names = [
  'zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3',
  't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7',
  't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra',
];

const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');

export default function RegisterPanel({
  cpu,
  changed,
  status,
}: {
  cpu: MipsCpu;
  changed: Set<number>;
  status: string;
}) {
  const [tab, setTab] = useState<'int' | 'fp'>('int');
  const regs = Array.from(cpu.registers, (value, index) => ({ name: `$${names[index]}`, value, i: index }));

  return (
    <>
      <div className="panelhead">
        <span>CPU STATE</span>
        <span className="status">{status}</span>
      </div>
      <div className="cpu-grid">
        <div><small>PC</small><b>0x{hex(cpu.pc)}</b></div>
        <div><small>HI</small><b>{cpu.hi}</b></div>
        <div><small>LO</small><b>{cpu.lo}</b></div>
        <div><small>Steps</small><b>{cpu.steps}</b></div>
        <div><small>Instructions</small><b>{cpu.program.instructions.length}</b></div>
        <div className="na" title="COP0 is not implemented in this build"><small>Status</small><b>—</b></div>
        <div className="na" title="COP0 is not implemented in this build"><small>Cause</small><b>—</b></div>
        <div className="na" title="COP0 is not implemented in this build"><small>EPC</small><b>—</b></div>
      </div>
      <div className="tabs">
        <button className={tab === 'int' ? 'active' : ''} onClick={() => setTab('int')}>Integer</button>
        <button className={tab === 'fp' ? 'active' : ''} onClick={() => setTab('fp')}>Floating point</button>
      </div>
      {tab === 'int' ? (
        <div className="reglist">
          {regs.map((r) => (
            <div
              className={changed.has(r.i) ? 'reg modified' : 'reg'}
              key={r.name}
              title={changed.has(r.i) ? 'Modified by the last step / run segment' : undefined}
            >
              <span>{r.name}</span>
              <code>{r.value}</code>
              <small>0x{hex(r.value)}</small>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="notice">
            <b>Floating point: NOT IMPLEMENTED.</b> This build has no FPU — $f0–$f31, FP comparisons and FP syscalls
            are unsupported and shown as —.
          </div>
          <div className="reglist">
            {Array.from({ length: 32 }, (_, i) => (
              <div className="reg" key={i}>
                <span>$f{i}</span>
                <code>—</code>
                <small>—</small>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
