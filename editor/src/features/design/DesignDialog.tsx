import type {CSSProperties} from 'react';
import {LlmStreamPanel} from '../../components/LlmStreamPanel';
import type {ModalType, SceneAsset, SceneAssetRole} from '../../types';

export function DesignDialog({
  modal,
  assets,
  assetFile,
  assetRole,
  assetNotes,
  assetLoading,
  onClose,
  onModalChange,
  onAssetFileChange,
  onAssetRoleChange,
  onAssetNotesChange,
  onRequestDesign,
}: {
  modal: Exclude<ModalType, null> & {kind: 'design'};
  assets: SceneAsset[];
  assetFile: File | null;
  assetRole: SceneAssetRole;
  assetNotes: string;
  assetLoading: boolean;
  onClose: () => void;
  onModalChange: (modal: Exclude<ModalType, null>) => void;
  onAssetFileChange: (file: File | null) => void;
  onAssetRoleChange: (role: SceneAssetRole) => void;
  onAssetNotesChange: (notes: string) => void;
  onRequestDesign: () => void;
}) {
  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <h2 style={{marginTop: 0}}>视觉设计方案 · {modal.sceneId}</h2>
        <p style={hintStyle}>像对话一样描述你想要的画面方向。可上传图片并选择它是风格参考，还是要进入 Remotion 画面的渲染素材。</p>
        <div style={designChatBoxStyle}>
          <label style={fieldLabelStyle}>
            设计要求
            <textarea
              value={modal.prompt}
              onChange={(event) => onModalChange({...modal, prompt: event.target.value})}
              placeholder="例如：参考这张图的构图和配色，开头先出现人物轮廓，再用时间轴卡片展开；字幕不要挡住主体。"
              disabled={modal.loading}
              style={{...textareaStyle, minHeight: 96}}
            />
          </label>
          <div style={assetUploadGridStyle}>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => onAssetFileChange(event.target.files?.[0] ?? null)}
              disabled={modal.loading || assetLoading}
              style={fileInputStyle}
            />
            <select
              value={assetRole}
              onChange={(event) => onAssetRoleChange(event.target.value as SceneAssetRole)}
              disabled={modal.loading || assetLoading}
              style={smallInputStyle}
            >
              <option value="reference">仅参考</option>
              <option value="render">渲染素材</option>
              <option value="both">两者都是</option>
            </select>
            <input
              value={assetNotes}
              onChange={(event) => onAssetNotesChange(event.target.value)}
              placeholder="图片说明：风格/构图/要出现的元素"
              disabled={modal.loading || assetLoading}
              style={smallInputStyle}
            />
            <span style={{fontSize: 12, color: assetFile ? '#8be9fd' : '#6f8098'}}>
              {assetFile ? `已选择：${assetFile.name}` : '可选图片'}
            </span>
          </div>
          {assets.length ? (
            <div style={designAssetRefsStyle}>
              {assets.map((asset) => (
                <span key={asset.id} style={assetRefPillStyle}>
                  {asset.role ?? 'both'} · {asset.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{display: 'flex', gap: 8, margin: '12px 0'}}>
          <button
            type="button"
            style={buttonStyle('#bd93f9', modal.loading || assetLoading)}
            onClick={onRequestDesign}
            disabled={modal.loading || assetLoading}
          >
            {modal.loading ? '设计生成中...' : '发送并生成设计方案'}
          </button>
          <button type="button" style={buttonStyle('#ff6b6b')} onClick={onClose}>
            关闭
          </button>
        </div>
        <LlmStreamPanel
          logs={modal.streamLogs}
          thinking={modal.thinking}
          result={modal.result ?? ''}
          error={modal.error}
          provider={modal.provider}
        />
      </div>
    </div>
  );
}

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 20,
};
const modalStyle: CSSProperties = {
  width: 'min(720px, 92vw)',
  maxHeight: '86vh',
  overflow: 'auto',
  background: '#11182c',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
  padding: 20,
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
};
const hintStyle: CSSProperties = {color: '#9fb3c8', fontSize: 13};
const designChatBoxStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  border: '1px solid rgba(139,233,253,0.14)',
  borderRadius: 14,
  background: 'rgba(139,233,253,0.04)',
};
const fieldLabelStyle: CSSProperties = {display: 'grid', gap: 6, fontSize: 12, color: '#9fb3c8', fontWeight: 700};
const textareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#070b16',
  color: '#e6edf3',
  padding: 10,
  lineHeight: 1.5,
  fontSize: 14,
};
const assetUploadGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 150px 1fr auto',
  gap: 8,
  alignItems: 'center',
};
const fileInputStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#070b16',
  color: '#e6edf3',
  padding: '7px 10px',
  fontSize: 13,
};
const smallInputStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#070b16',
  color: '#e6edf3',
  padding: '9px 10px',
  fontSize: 13,
};
const designAssetRefsStyle: CSSProperties = {display: 'flex', gap: 6, flexWrap: 'wrap'};
const assetRefPillStyle: CSSProperties = {
  fontSize: 11,
  color: '#c8dcff',
  border: '1px solid rgba(139,233,253,0.22)',
  background: 'rgba(139,233,253,0.08)',
  borderRadius: 999,
  padding: '4px 8px',
};

function buttonStyle(color: string, disabled = false): CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.05)' : `${color}18`,
    color: disabled ? '#6f8098' : color,
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : `${color}55`}`,
    borderRadius: 10,
    padding: '9px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: 13,
    opacity: disabled ? 0.62 : 1,
  };
}
