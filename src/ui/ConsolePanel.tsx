import type { FormEvent, RefObject } from 'react';
import type { MipsCpu } from '../core/cpu';
import type { Diagnostic } from '../diagnostics';
import DiagnosticsPanel from './DiagnosticsPanel';

export type Msg = { id: number; kind: 'info' | 'success' | 'error'; text: string; time: string };

export default function ConsolePanel(props: {
  cpu: MipsCpu;
  tab: 'console' | 'messages';
  setTab: (t: 'console' | 'messages') => void;
  error: string;
  inputValue: string;
  setInputValue: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement>;
  messages: Msg[];
  onClearMessages: () => void;
  diags: Diagnostic[];
  selectedDiagId?: string;
  onSelectDiag: (d: Diagnostic) => void;
  onApplyFix: (d: Diagnostic) => void;
}) {
  const { cpu, tab, setTab } = props;
  return (
    <>
      <div className="tabs">
        <button className={tab === 'console' ? 'active' : ''} onClick={() => setTab('console')}>
          Console
        </button>
        <button className={tab === 'messages' ? 'active' : ''} onClick={() => setTab('messages')}>
          Messages
        </button>
        {tab === 'messages' && props.messages.length > 0 && (
          <button className="tabclear" onClick={props.onClearMessages}>
            Clear
          </button>
        )}
      </div>
      {props.error && <div className="error">{props.error}</div>}
      {tab === 'console' ? (
        <div className="consolewrap">
          <pre className="console">{cpu.output.join('') || 'Program output appears here.'}</pre>
          {cpu.inputPending && (
            <form className="inputline" onSubmit={props.onSubmit}>
              <input
                ref={props.inputRef}
                value={props.inputValue}
                onChange={(e) => props.setInputValue(e.target.value)}
                placeholder={
                  cpu.inputPending.kind === 'int'
                    ? 'Enter integer…'
                    : cpu.inputPending.kind === 'char'
                      ? 'Enter a character…'
                      : 'Enter text…'
                }
                aria-label="Program input"
              />
              <button className="btn primary" type="submit">
                Enter
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="messages">
          <DiagnosticsPanel
            diags={props.diags}
            selectedId={props.selectedDiagId}
            onSelect={props.onSelectDiag}
            onApplyFix={props.onApplyFix}
          />
          <div className="logblock">
            <div className="logsep">Log</div>
            {[...props.messages].reverse().map((m) => (
              <div className={`msg ${m.kind}`} key={m.id}>
                <span className="time">{m.time}</span>
                {m.text}
              </div>
            ))}
            {props.messages.length === 0 && <div className="msg">No messages yet.</div>}
          </div>
        </div>
      )}
    </>
  );
}
