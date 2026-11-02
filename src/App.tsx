import { useState, useRef, useEffect, type ChangeEvent, type FormEvent } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { forEachDiagnostic, lintGutter, setDiagnostics, type Diagnostic as CmdDiagnostic } from '@codemirror/lint';
import { mipsLanguage } from './core/mipsLanguage';
import { Play, StepForward, Sun, Moon, FolderOpen, Save, Square, FilePlus, Hammer, RefreshCcw, Pause } from 'lucide-react';
import type { Program } from './core/types';
import { MipsCpu } from './core/cpu';
import {
  assembleWithDiagnostics,
  runtimeDiagnostic,
  executionLimitDiagnostic,
  invalidInputDiagnostic,
  planQuickFix,
  applyQuickFix,
  offsetOf,
  type Diagnostic,
} from './diagnostics';
import MenuBar from './ui/MenuBar';
import RegisterPanel from './ui/RegisterPanel';
import { TextView, DataView } from './ui/Views';
import ConsolePanel, { type Msg } from './ui/ConsolePanel';

const starter = `# MIPS32 Offline IDE — MVP demo
.text
li $t0, 20
li $t1, 5
add $t2, $t0, $t1
sub $t3, $t0, $t1
mult $t0, $t1
mflo $t4
# MARS syscall 1 prints integer in $a0
li $v0, 1
move $a0, $t2
syscall
li $v0, 10
syscall`;
const blank = `# New MIPS32 program
.text
.globl main
main:
    li $v0, 10
    syscall
`;
const CHUNK = 50_000;
const TOTAL_BUDGET = 5_000_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pcHex = (pc: number) => `PC 0x${(pc >>> 0).toString(16).padStart(8, '0')}`;
const diffRegs = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const s = new Set<number>();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) s.add(i);
  return s;
};

export default function App() {
  const [code, setCode] = useState(starter);
  const [dark, setDark] = useState(true);
  const [sourceName, setSourceName] = useState('main.s');
  const [exec, setExec] = useState<{ cpu: MipsCpu; loadedCode: string }>(() => ({ cpu: new MipsCpu(), loadedCode: '' }));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Ready');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [bottomTab, setBottomTab] = useState<'console' | 'messages'>('console');
  const [leftTab, setLeftTab] = useState<'editor' | 'text' | 'data'>('editor');
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [selectedDiagId, setSelectedDiagId] = useState<string | undefined>(undefined);
  const [inputValue, setInputValue] = useState('');
  const [running, setRunning] = useState(false);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const [leftW, setLeftW] = useState(560);
  const [dragging, setDragging] = useState(false);
  const [desktop, setDesktop] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px)').matches);
  const stoppedRef = useRef(false);
  const pauseRef = useRef(false);
  const msgSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const diagSourceRef = useRef('');
  const fixHandlerRef = useRef<(d: Diagnostic) => void>(() => {});
  const cpu = exec.cpu;

  const pushMsg = (kind: Msg['kind'], text: string) =>
    setMessages((m) =>
      [{ id: ++msgSeq.current, kind, text, time: new Date().toLocaleTimeString([], { hour12: false }) }, ...m].slice(0, 300),
    );

  const updateDiags = (next: Diagnostic[], source: string) => {
    diagSourceRef.current = source;
    setDiags(next);
    setSelectedDiagId(next.length ? next[0].id : undefined);
  };

  const addDiag = (d: Diagnostic) => {
    setDiags((ds) => [...ds, d]);
    setSelectedDiagId(d.id);
  };

  const compile = (): Program | null => {
    const r = assembleWithDiagnostics(code, sourceName);
    updateDiags(r.diagnostics, code);
    if (r.program) {
      setError('');
      return r.program;
    }
    const m = r.errorMessage ?? r.diagnostics[0]?.message ?? 'Assembly failed.';
    setError(m);
    setStatus('Assembly error');
    pushMsg('error', m);
    setBottomTab('messages');
    if (r.diagnostics[0]) setSelectedDiagId(r.diagnostics[0].id);
    return null;
  };

  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const onChange = () => setDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (cpu.inputPending) {
      setBottomTab('console');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [cpu.inputPending]);

  useEffect(() => {
    if (leftTab !== 'editor') {
      viewRef.current = null;
      return;
    }
    const v = viewRef.current;
    if (!v) return;
    const source = diagSourceRef.current || code;
    const cm: CmdDiagnostic[] = [];
    for (const d of diags) {
      if (d.line === undefined || d.column === undefined) continue;
      const from = offsetOf(source, d.line, d.column);
      const end = d.endLine !== undefined && d.endColumn !== undefined ? offsetOf(source, d.endLine, d.endColumn) : from;
      const cmd: CmdDiagnostic = {
        from,
        to: Math.max(end, from),
        severity: d.severity,
        message: `${d.code}: ${d.title}`,
        source: d.id,
      };
      if (d.quickFix) {
        cmd.actions = [{ name: `Fix: ${d.quickFix.title}`, apply: () => fixHandlerRef.current(d) }];
      }
      cm.push(cmd);
    }
    v.dispatch(setDiagnostics(v.state, cm));
  }, [diags, leftTab]);

  const finishStatus = (c: MipsCpu) => {
    if (c.halted) setStatus('Halted');
    else if (c.inputPending) setStatus('Waiting for input');
    else setStatus(`Paused · ${pcHex(c.pc)}`);
  };

  /** Chunked async run: yields to the browser between chunks so the UI stays responsive. */
  const pump = async (c: MipsCpu, loaded: string) => {
    setRunning(true);
    stoppedRef.current = false;
    pauseRef.current = false;
    try {
      for (;;) {
        const before = Int32Array.from(c.registers);
        const chunk = c.runChunk(CHUNK);
        setChanged(diffRegs(before, c.registers));
        setExec({ cpu: c, loadedCode: loaded });
        if (chunk.pausedForInput) { setStatus('Waiting for input'); return; }
        if (c.halted) { setStatus('Halted'); return; }
        if (pauseRef.current) { setStatus(`Paused · ${pcHex(c.pc)}`); return; }
        if (stoppedRef.current) { setStatus(`Stopped · ${pcHex(c.pc)}`); return; }
        if (c.steps >= TOTAL_BUDGET) {
          const m = `Execution stopped after ${TOTAL_BUDGET} steps (possible infinite loop)`;
          setError(m);
          setStatus('Error');
          pushMsg('error', m);
          updateDiags([executionLimitDiagnostic(c, TOTAL_BUDGET, loaded, sourceName)], loaded);
          setBottomTab('messages');
          return;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      const m = message(e);
      setError(m);
      setStatus('Runtime error');
      pushMsg('error', m);
      updateDiags([runtimeDiagnostic(e, c, loaded, sourceName)], loaded);
      setBottomTab('messages');
    } finally {
      setRunning(false);
    }
  };

  const onAssemble = () => {
    if (running) return;
    const program = compile();
    if (!program) return;
    const fresh = new MipsCpu();
    fresh.load(program);
    setExec({ cpu: fresh, loadedCode: code });
    setChanged(new Set());
    setInputValue('');
    setStatus('Assembled');
    pushMsg('success', `Assembled ${sourceName}: ${program.instructions.length} instructions, ${program.labels.size} labels.`);
  };

  const onReinitialize = () => {
    if (running) return;
    const cur = exec.cpu;
    if (cur.program.instructions.length === 0) {
      const m = 'Nothing to reinitialize — assemble first (F6).';
      setError(m);
      setStatus('Assembly error');
      pushMsg('error', m);
      setBottomTab('messages');
      return;
    }
    const fresh = new MipsCpu();
    fresh.load(cur.program);
    setExec({ cpu: fresh, loadedCode: exec.loadedCode });
    setChanged(new Set());
    setInputValue('');
    setError('');
    setStatus('Reinitialized');
    pushMsg('info', `Reinitialized: registers and memory cleared, program reloaded (${fresh.program.instructions.length} instructions).`);
  };

  const onRun = () => {
    if (running) return;
    let next = exec.cpu;
    let loaded = exec.loadedCode;
    if (loaded !== code || next.program.instructions.length === 0) {
      const program = compile();
      if (!program) return;
      next = new MipsCpu();
      next.load(program);
      loaded = code;
      setExec({ cpu: next, loadedCode: code });
      setChanged(new Set());
      pushMsg('info', `Assembled ${sourceName} before run: ${program.instructions.length} instructions.`);
    } else if (next.halted) {
      const program = next.program;
      next = new MipsCpu();
      next.load(program);
      setExec({ cpu: next, loadedCode: loaded });
      setChanged(new Set());
    }
    void pump(next, loaded);
  };

  const onPause = () => {
    if (!running) return;
    pauseRef.current = true;
    setStatus('Pausing…');
  };

  const onStop = () => {
    if (!running) return;
    stoppedRef.current = true;
  };

  const onStep = () => {
    if (running) return;
    let next = exec.cpu;
    let loaded = exec.loadedCode;
    if (loaded !== code || next.program.instructions.length === 0 || (next.halted && next.steps === 0)) {
      const program = compile();
      if (!program) return;
      next = new MipsCpu();
      next.load(program);
      loaded = code;
      setExec({ cpu: next, loadedCode: code });
    }
    const before = Int32Array.from(next.registers);
    try {
      next.step();
      setChanged(diffRegs(before, next.registers));
      setExec({ cpu: next, loadedCode: loaded });
      finishStatus(next);
    } catch (e) {
      const m = message(e);
      setError(m);
      setStatus('Runtime error');
      pushMsg('error', m);
      updateDiags([runtimeDiagnostic(e, next, loaded, sourceName)], loaded);
      setBottomTab('messages');
    }
  };

  const dropInputDiags = () => setDiags((ds) => ds.filter((d) => d.code !== 'SYS004'));

  const submitInput = (e: FormEvent) => {
    e.preventDefault();
    const c = exec.cpu;
    if (!c.inputPending) return;
    const raw = inputValue;
    const kind = c.inputPending.kind;
    if (kind === 'int') {
      const n = Number(raw.trim());
      if (!raw.trim() || !Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
        setError('Enter a valid 32-bit integer (-2147483648..2147483647)');
        addDiag(invalidInputDiagnostic('int', raw, c, exec.loadedCode, sourceName));
        return;
      }
      setError('');
      dropInputDiags();
      c.provideInput(n);
    } else if (kind === 'char') {
      if (raw.length < 1) {
        setError('Enter at least one character');
        addDiag(invalidInputDiagnostic('char', raw, c, exec.loadedCode, sourceName));
        return;
      }
      setError('');
      dropInputDiags();
      c.provideInput(raw[0]);
    } else {
      setError('');
      dropInputDiags();
      c.provideInput(raw);
    }
    setInputValue('');
    void pump(c, exec.loadedCode);
  };

  const applyFix = (d: Diagnostic) => {
    if (!d.quickFix) return;
    const view = viewRef.current;
    if (view) {
      const src = view.state.doc.toString();
      const plan = planQuickFix(src, d.quickFix);
      if (!plan || !plan.length) {
        pushMsg('error', 'Quick fix no longer matches the source — press F6 to re-assemble.');
        return;
      }
      view.dispatch({
        changes: plan.map((p) => ({ from: p.from, to: p.to, insert: p.insert })),
        selection: { anchor: plan[0].from },
        scrollIntoView: true,
      });
      pushMsg('info', `Applied fix: ${d.quickFix.title}. Press F6 to re-assemble.`);
      updateDiags([], view.state.doc.toString());
      return;
    }
    const out = applyQuickFix(code, d.quickFix);
    if (out === null) {
      pushMsg('error', 'Quick fix no longer matches the source — press F6 to re-assemble.');
      return;
    }
    setCode(out);
    pushMsg('info', `Applied fix: ${d.quickFix.title}. Press F6 to re-assemble.`);
    updateDiags([], out);
  };
  fixHandlerRef.current = applyFix;

  const focusDiagnostic = (d: Diagnostic) => {
    setSelectedDiagId(d.id);
    if (d.line === undefined || d.column === undefined) return;
    setLeftTab('editor');
    requestAnimationFrame(() => {
      const v = viewRef.current;
      if (!v) return;
      let from: number | undefined;
      let to: number | undefined;
      forEachDiagnostic(v.state, (cd, f, t) => {
        if (from === undefined && cd.source === d.id) {
          from = f;
          to = t;
        }
      });
      if (from === undefined) {
        const src = diagSourceRef.current || code;
        from = offsetOf(src, d.line ?? 1, d.column ?? 1);
        to = d.endLine !== undefined && d.endColumn !== undefined ? offsetOf(src, d.endLine, d.endColumn) : from;
      }
      v.dispatch({ selection: { anchor: from, head: Math.max(to ?? from, from) }, scrollIntoView: true });
      v.focus();
    });
  };

  const download = () => {
    const name = sourceName.endsWith('.s') ? sourceName : `${sourceName}.s`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    pushMsg('info', `Saved ${name} (download).`);
  };

  const openFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCode(text);
      setSourceName(file.name);
      setExec({ cpu: new MipsCpu(), loadedCode: '' });
      setChanged(new Set());
      updateDiags([], text);
      setStatus(`Loaded ${file.name}`);
      pushMsg('info', `Opened ${file.name} — press Assemble (F6) to build it.`);
    };
    reader.onerror = () => {
      const m = `Could not read file "${file.name}"`;
      setError(m);
      setStatus('Error');
      pushMsg('error', m);
    };
    reader.readAsText(file);
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    openFile(file);
  };

  const onNew = () => {
    setCode(blank);
    setSourceName('untitled.s');
    setExec({ cpu: new MipsCpu(), loadedCode: '' });
    setChanged(new Set());
    setError('');
    updateDiags([], blank);
    setStatus('New program');
    pushMsg('info', 'New program created — edit, then press Assemble (F6).');
  };

  const onHelp = () => {
    setBottomTab('messages');
    pushMsg('info', 'MIPS32 Offline IDE — shortcuts: F5 Run/Resume, F6 Assemble, F10 Step. Simulator menu mirrors the toolbar.');
    pushMsg('info', 'Assembler errors report filename, line and category. Floating point and COP0 are NOT implemented. Android APK build is BLOCKED (Android SDK not installed).');
  };

  const onToggleTheme = () => setDark((d) => !d);

  // F5/F6/F10 shortcuts (QtSPIM-style). preventDefault stops F5 reloading the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'F5') { e.preventDefault(); onRun(); }
      else if (e.key === 'F6') { e.preventDefault(); onAssemble(); }
      else if (e.key === 'F10') { e.preventDefault(); onStep(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const startDrag = (e: React.MouseEvent) => {
    if (!desktop) return;
    e.preventDefault();
    setDragging(true);
    const move = (ev: MouseEvent) => {
      const el = wsRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 14;
      const w = ev.clientX - r.left - pad;
      setLeftW(Math.round(Math.min(Math.max(w, 280), Math.max(320, r.width - 300 - pad * 2 - 7))));
    };
    const up = () => {
      setDragging(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  return (
    <main className={dark ? 'app dark' : 'app light'}>
      <header className="topbar">
        <div className="brand">
          <div className="chip">M</div>
          <div>
            <strong>MIPS32 Offline IDE</strong>
            <small>QtSPIM-inspired · local assembler · emulator · no account</small>
          </div>
        </div>
        <button className="iconbtn" onClick={onToggleTheme} aria-label="Toggle theme">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <MenuBar
        running={running}
        onNew={onNew}
        onOpen={() => fileInputRef.current?.click()}
        onSave={download}
        onAssemble={onAssemble}
        onReinitialize={onReinitialize}
        onRun={onRun}
        onPause={onPause}
        onStep={onStep}
        onStop={onStop}
        dark={dark}
        onToggleTheme={onToggleTheme}
        onHelp={onHelp}
      />

      <section className="toolbar">
        <input
          className="filename"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          aria-label="Filename"
        />
        <button type="button" className="btn secondary" onClick={onNew}>
          <FilePlus size={16} /> New
        </button>
        <button type="button" className="btn secondary" onClick={() => fileInputRef.current?.click()}>
          <FolderOpen size={16} /> Open
        </button>
        <input ref={fileInputRef} hidden type="file" accept=".s,.asm,.txt,text/plain" onChange={onFilePicked} />
        <button className="btn secondary" onClick={download}>
          <Save size={16} /> Save
        </button>
        <span className="tsep" />
        <button className="btn secondary" onClick={onAssemble} disabled={running} title="Assemble (F6)">
          <Hammer size={16} /> Assemble
        </button>
        <button className="btn secondary" onClick={onReinitialize} disabled={running} title="Reinitialize registers and memory">
          <RefreshCcw size={16} /> Reinitialize
        </button>
        <span className="grow" />
        <span className="status">{status}</span>
        <button className="btn primary" onClick={onRun} disabled={running} title="Run / Resume (F5)">
          <Play size={16} /> Run
        </button>
        <button className="btn secondary" onClick={onPause} disabled={!running} title="Pause">
          <Pause size={16} /> Pause
        </button>
        <button className="btn secondary" onClick={onStep} disabled={running} title="Step (F10)">
          <StepForward size={16} /> Step
        </button>
        <button className="btn secondary" onClick={onStop} disabled={!running} title="Stop">
          <Square size={16} /> Stop
        </button>
      </section>

      <section
        className="workspace"
        ref={wsRef}
        style={desktop ? { gridTemplateColumns: `${leftW}px 7px minmax(300px, 1fr)` } : undefined}
      >
        <div className="panel editor-panel">
          <div className="lefttabs">
            <div className="tabs">
              <button className={leftTab === 'editor' ? 'active' : ''} onClick={() => setLeftTab('editor')}>Editor</button>
              <button className={leftTab === 'text' ? 'active' : ''} onClick={() => setLeftTab('text')}>Text</button>
              <button className={leftTab === 'data' ? 'active' : ''} onClick={() => setLeftTab('data')}>Data</button>
            </div>
            <span className="hint">{sourceName}</span>
          </div>
          {leftTab === 'editor' && (
            <CodeMirror
              value={code}
              height="100%"
              theme={dark ? 'dark' : 'light'}
              extensions={[EditorView.lineWrapping, mipsLanguage, lintGutter()]}
              onChange={setCode}
              onCreateEditor={(view) => {
                viewRef.current = view;
              }}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            />
          )}
          {leftTab === 'text' && <TextView program={cpu.program} pc={cpu.pc} />}
          {leftTab === 'data' && <DataView cpu={cpu} />}
        </div>

        <div className={dragging ? 'splitter active' : 'splitter'} onMouseDown={startDrag} aria-hidden="true" />

        <div className="rightcol">
          <div className="panel">
            <RegisterPanel cpu={cpu} changed={changed} status={status} />
          </div>
          <div className="panel bottom-panel">
            <ConsolePanel
              cpu={cpu}
              tab={bottomTab}
              setTab={setBottomTab}
              error={error}
              inputValue={inputValue}
              setInputValue={setInputValue}
              onSubmit={submitInput}
              inputRef={inputRef}
              messages={messages}
              onClearMessages={() => setMessages([])}
              diags={diags}
              selectedDiagId={selectedDiagId}
              onSelectDiag={focusDiagnostic}
              onApplyFix={applyFix}
            />
          </div>
        </div>
      </section>

      <footer>
        Offline MIPS32 IDE · syscalls 1, 4, 5, 8, 10, 11, 12 · F5 Run · F6 Assemble · F10 Step · FP and COP0 not
        implemented
      </footer>
    </main>
  );
}
