import type {CSSProperties} from 'react';

const logBoxStyle: CSSProperties = {
  overflow: 'auto',
  background: '#05070d',
  borderRadius: 12,
  padding: 12,
  fontFamily: 'Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  maxHeight: 320,
};
const tuneResultStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  background: '#05070d',
  borderRadius: 12,
  padding: 12,
  color: '#e6edf3',
  maxHeight: 260,
  overflow: 'auto',
  fontSize: 13,
  lineHeight: 1.6,
};
const thinkingPreviewStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  background: '#07101e',
  borderRadius: 12,
  padding: 12,
  color: '#b8c7ff',
  maxHeight: 180,
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.6,
  border: '1px solid rgba(139,233,253,0.12)',
};
const streamLabelStyle: CSSProperties = {fontSize: 12, color: '#9fb3c8', marginBottom: 6, fontWeight: 700};

function badgeStyle(color: string): CSSProperties {
  return {fontSize: 11, color, border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', background: `${color}12`};
}

export function LlmStreamPanel({
  logs = [],
  thinking = '',
  result = '',
  error,
  provider,
}: {
  logs?: string[];
  thinking?: string;
  result?: string;
  error?: string;
  provider?: string;
}) {
  if (!logs.length && !thinking && !result && !error && !provider) return null;
  return (
    <div style={{display: 'grid', gap: 10, marginTop: 12}}>
      <div style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
        {provider ? <span style={badgeStyle('#8be9fd')}>provider: {provider}</span> : null}
        {error ? <span style={badgeStyle('#ff6b6b')}>error</span> : null}
      </div>
      {logs.length ? (
        <div style={{...logBoxStyle, maxHeight: 120}}>
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
      {thinking ? (
        <div>
          <div style={streamLabelStyle}>思考过程</div>
          <pre style={thinkingPreviewStyle}>{thinking}</pre>
        </div>
      ) : null}
      {result ? (
        <div>
          <div style={streamLabelStyle}>实时回复</div>
          <pre style={tuneResultStyle}>{result}</pre>
        </div>
      ) : null}
      {error ? <pre style={{...tuneResultStyle, color: '#ffb4b4'}}>{error}</pre> : null}
    </div>
  );
}
