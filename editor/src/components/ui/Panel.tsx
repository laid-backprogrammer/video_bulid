import type {CSSProperties, ReactNode} from 'react';

const panelCardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 14,
  marginBottom: 12,
};

export function Panel({title, subtitle, children}: {title: string; subtitle: string; children: ReactNode}) {
  return (
    <div style={panelCardStyle}>
      <div style={{marginBottom: 12}}>
        <h3 style={{margin: 0, fontSize: 15}}>{title}</h3>
        <p style={{margin: '4px 0 0', fontSize: 12, color: '#9fb3c8'}}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
