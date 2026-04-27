import type {CSSProperties, MouseEvent, ReactNode} from 'react';

function miniButtonStyle(color = '#8be9fd', disabled = false): CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.04)' : `${color}12`,
    color: disabled ? '#617089' : color,
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.1)' : `${color}25`}`,
    borderRadius: 8,
    padding: '6px 10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    opacity: disabled ? 0.58 : 1,
  };
}

export function MiniBtn({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      style={miniButtonStyle('#8be9fd', Boolean(disabled))}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}
