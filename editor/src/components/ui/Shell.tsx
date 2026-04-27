import type {CSSProperties, ReactNode} from 'react';

const shellStyle: CSSProperties = {
  height: '100vh',
  background: '#0b1020',
  color: '#e6edf3',
  fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
  overflow: 'hidden',
};

export function Shell({children}: {children: ReactNode}) {
  return <div style={shellStyle}>{children}</div>;
}
