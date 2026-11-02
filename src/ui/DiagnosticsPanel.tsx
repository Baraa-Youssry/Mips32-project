import { summarize, type Diagnostic, type DiagnosticSeverity } from '../diagnostics';

const severityLabel: Record<DiagnosticSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  hint: 'Hint',
};

const order: DiagnosticSeverity[] = ['error', 'warning', 'info', 'hint'];

export default function DiagnosticsPanel(props: {
  diags: Diagnostic[];
  selectedId?: string;
  onSelect: (d: Diagnostic) => void;
  onApplyFix: (d: Diagnostic) => void;
}) {
  const { diags } = props;
  const selected = diags.find((d) => d.id === props.selectedId) ?? diags[0];
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of diags) counts[d.severity]++;

  return (
    <div className="diagpanel">
      <div className="diagsummary">
        <span className="diagsumtext">{summarize(diags)}</span>
        {order.map((s) =>
          counts[s] > 0 ? (
            <span className={`diagchip ${s}`} key={s}>
              {counts[s]} {severityLabel[s]}
              {counts[s] === 1 ? '' : 's'}
            </span>
          ) : null,
        )}
      </div>

      {diags.length === 0 ? (
        <div className="diagempty">No diagnostics. Press Assemble (F6) to check the program.</div>
      ) : (
        <div className="diagtable" role="list">
          <div className="diagrow head">
            <span>Severity</span>
            <span>Code</span>
            <span>Description</span>
            <span>Location</span>
          </div>
          {diags.map((d) => (
            <button
              type="button"
              role="listitem"
              key={d.id}
              className={`diagrow item ${d.id === selected?.id ? 'sel' : ''}`}
              onClick={() => props.onSelect(d)}
            >
              <span className={`sev ${d.severity}`}>{severityLabel[d.severity]}</span>
              <span className="dcode">{d.code}</span>
              <span className="ddesc">{d.title}</span>
              <span className="dloc">
                {d.line !== undefined ? `L${d.line}${d.column !== undefined ? `:${d.column}` : ''}` : '—'}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="diagdetails">
          <div className="dethead">
            <strong>
              {selected.code} · {selected.title}
            </strong>
            <span className={`sev ${selected.severity}`}>{severityLabel[selected.severity]}</span>
          </div>
          <div className="detloc">
            {selected.file ? `${selected.file} · ` : ''}
            {selected.line !== undefined
              ? `Line ${selected.line}${selected.column !== undefined ? `, column ${selected.column}` : ''}`
              : 'No line information'}
            {' · '}
            {selected.phase}
          </div>
          <dl className="detlist">
            <dt>Reason</dt>
            <dd>{selected.message}</dd>
            <dt>Explanation</dt>
            <dd>{selected.explanation}</dd>
            {selected.actual !== undefined && (
              <>
                <dt>Actual</dt>
                <dd>
                  <code className="mono">{selected.actual}</code>
                </dd>
              </>
            )}
            {selected.expected && selected.expected.length > 0 && (
              <>
                <dt>Expected</dt>
                <dd>{selected.expected.join(' or ')}</dd>
              </>
            )}
            {selected.suggestion && (
              <>
                <dt>Suggestion</dt>
                <dd>{selected.suggestion}</dd>
              </>
            )}
            {selected.example && (selected.example.before || selected.example.after) && (
              <>
                <dt>Example</dt>
                <dd className="example">
                  {selected.example.before && <code className="before">{selected.example.before}</code>}
                  {selected.example.after && <code className="after">{selected.example.after}</code>}
                </dd>
              </>
            )}
            {selected.relatedInformation && selected.relatedInformation.length > 0 && (
              <>
                <dt>Related</dt>
                <dd>
                  {selected.relatedInformation.map((r, i) => (
                    <div key={i}>
                      {r.message}
                      {r.line !== undefined ? ` (line ${r.line})` : ''}
                    </div>
                  ))}
                </dd>
              </>
            )}
            {selected.context && selected.context.length > 0 && (
              <>
                <dt>Context</dt>
                <dd className="ctxlist">
                  {selected.context.map((c, i) => (
                    <span className="ctxitem" key={i}>
                      <span className="ctxlabel">{c.label}</span>
                      <span className="ctxvalue">{c.value}</span>
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
          {selected.quickFix && (
            <button type="button" className="btn primary fixbtn" onClick={() => props.onApplyFix(selected)}>
              Apply Fix: {selected.quickFix.title}
            </button>
          )}
          {selected.technicalDetail && (
            <p className="techdetail">
              Technical detail: <code>{selected.technicalDetail}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
