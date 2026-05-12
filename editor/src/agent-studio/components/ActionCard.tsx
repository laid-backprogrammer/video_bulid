import type {CSSProperties} from 'react';
import type {AgentAction} from '../types';

export function ActionCard({
  action,
  disabled,
  running,
  onRun,
}: {
  action: AgentAction;
  disabled: boolean;
  running: boolean;
  onRun: (action: AgentAction) => void;
}) {
  const tone = action.tone ?? 'neutral';
  const color = tone === 'primary' ? '#4cc9f0' : tone === 'warn' ? '#ffb703' : '#a8dadc';
  return (
    <article style={cardStyle(color)}>
      <div style={{minWidth: 0}}>
        <div style={titleRowStyle}>
          <strong style={{fontSize: 13, color: '#f7fbff'}}>{action.label}</strong>
          {action.sceneId ? <span style={scenePillStyle}>{action.sceneId}</span> : null}
        </div>
        <p style={descStyle}>{action.disabledReason || action.description}</p>
      </div>
      <button
        type="button"
        style={runButtonStyle(color, disabled || running || Boolean(action.disabledReason))}
        disabled={disabled || running || Boolean(action.disabledReason)}
        onClick={() => onRun(action)}
      >
        {running ? '执行中' : '确认执行'}
      </button>
    </article>
  );
}

const cardStyle = (color: string): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 10,
  alignItems: 'center',
  padding: 10,
  borderRadius: 8,
  border: `1px solid ${color}40`,
  background: `${color}12`,
});
const titleRowStyle: CSSProperties = {display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'};
const scenePillStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 999,
  padding: '2px 7px',
  color: '#9fb3c8',
  fontSize: 11,
};
const descStyle: CSSProperties = {margin: '5px 0 0', color: '#aebed2', fontSize: 12, lineHeight: 1.45};

const runButtonStyle = (color: string, disabled: boolean): CSSProperties => ({
  border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : `${color}88`}`,
  background: disabled ? 'rgba(255,255,255,0.05)' : `${color}20`,
  color: disabled ? '#6f8098' : color,
  borderRadius: 8,
  padding: '8px 10px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 800,
  whiteSpace: 'nowrap',
});

