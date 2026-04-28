import type {CSSProperties} from 'react';
import {LlmStreamPanel} from '../../components/LlmStreamPanel';
import type {ModalType, SceneAsset, SceneAssetDraft, SceneAssetRole} from '../../types';

const assetMention = (asset: Pick<SceneAsset, 'alias' | 'id'>) => `@${asset.alias ?? asset.id}`;

const mediaAccept = [
  '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml',
  '.mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime',
  '.mp3,.wav,.m4a,.aac,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg',
].join(',');

const assetTypeLabel = (type?: string) => (
  type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'
);

const appendMention = (prompt: string, mention: string) => {
  const trimmed = prompt.trimEnd();
  return `${trimmed}${trimmed ? ' ' : ''}${mention} `;
};

const draftMention = (draft: Pick<SceneAssetDraft, 'alias' | 'file'>) => {
  const fallback = draft.file.name
    .normalize('NFKC')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `@${draft.alias.replace(/^@+/, '') || fallback || 'asset'}`;
};

export function DesignDialog({
  modal,
  assets,
  assetDrafts,
  assetLoading,
  onClose,
  onModalChange,
  onAssetFilesChange,
  onAssetDraftChange,
  onAssetDraftRemove,
  onRequestDesign,
}: {
  modal: Exclude<ModalType, null> & {kind: 'design'};
  assets: SceneAsset[];
  assetDrafts: SceneAssetDraft[];
  assetLoading: boolean;
  onClose: () => void;
  onModalChange: (modal: Exclude<ModalType, null>) => void;
  onAssetFilesChange: (files: FileList | null) => void;
  onAssetDraftChange: (draftId: string, patch: Partial<Pick<SceneAssetDraft, 'alias' | 'role' | 'notes'>>) => void;
  onAssetDraftRemove: (draftId: string) => void;
  onRequestDesign: () => void;
}) {
  const controlsDisabled = modal.loading || assetLoading;
  const fileInputKey = `${modal.sceneId}-${assetDrafts.length}`;
  const insertMention = (mention: string) => onModalChange({...modal, prompt: appendMention(modal.prompt, mention)});

  return (
    <div style={modalBackdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <h2 style={{marginTop: 0}}>视觉设计方案 · {modal.sceneId}</h2>
        <p style={hintStyle}>像对话一样描述画面方向，可用 @素材名 点名安排图片、视频和音频的用途、位置、运动或触发时机。</p>
        <div style={designChatBoxStyle}>
          <label style={fieldLabelStyle}>
            设计要求
            <textarea
              value={modal.prompt}
              onChange={(event) => onModalChange({...modal, prompt: event.target.value})}
              placeholder="例如：@screen 从虚拟电脑里弹出，@click 在鼠标按下的 32f 播放点击音效；@logo 放右上角轻微发光。"
              disabled={modal.loading}
              style={{...textareaStyle, minHeight: 96}}
            />
          </label>
          <div style={assetUploadGridStyle}>
            <input
              key={fileInputKey}
              type="file"
              multiple
              accept={mediaAccept}
              onChange={(event) => onAssetFilesChange(event.target.files)}
              disabled={controlsDisabled}
              style={fileInputStyle}
            />
            <span style={{fontSize: 12, color: assetDrafts.length ? '#8be9fd' : '#6f8098'}}>
              {assetDrafts.length ? `待上传 ${assetDrafts.length} 个` : '可选素材'}
            </span>
          </div>
          {assetDrafts.length ? (
            <div style={draftListStyle}>
              {assetDrafts.map((draft) => (
                <div key={draft.id} style={draftItemStyle}>
                  <span style={typePillStyle}>{assetTypeLabel(draft.assetType)}</span>
                  <input
                    value={draft.alias}
                    onChange={(event) => onAssetDraftChange(draft.id, {alias: event.target.value.replace(/^@+/, '')})}
                    placeholder="@素材名"
                    disabled={controlsDisabled}
                    style={smallInputStyle}
                  />
                  {draft.assetType === 'image' ? (
                    <select
                      value={draft.role}
                      onChange={(event) => onAssetDraftChange(draft.id, {role: event.target.value as SceneAssetRole})}
                      disabled={controlsDisabled}
                      style={smallInputStyle}
                    >
                      <option value="reference">仅参考</option>
                      <option value="render">渲染素材</option>
                      <option value="both">两者都是</option>
                    </select>
                  ) : (
                    <span style={lockedRoleStyle}>插入素材</span>
                  )}
                  <input
                    value={draft.notes}
                    onChange={(event) => onAssetDraftChange(draft.id, {notes: event.target.value})}
                    placeholder="这张图的说明 / 操作"
                    disabled={controlsDisabled}
                    style={smallInputStyle}
                  />
                  <button
                    type="button"
                    title="插入素材提及"
                    style={miniButtonStyle('#8be9fd', controlsDisabled)}
                    disabled={controlsDisabled}
                    onClick={() => insertMention(draftMention(draft))}
                  >
                    @
                  </button>
                  <button
                    type="button"
                    style={miniButtonStyle('#ff6b6b', controlsDisabled)}
                    disabled={controlsDisabled}
                    onClick={() => onAssetDraftRemove(draft.id)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {assets.length ? (
            <div style={designAssetRefsStyle}>
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  style={assetRefPillStyle}
                  onClick={() => insertMention(assetMention(asset))}
                  disabled={controlsDisabled}
                >
                  {assetMention(asset)} · {assetTypeLabel(asset.assetType)} · {asset.role ?? 'both'} · {asset.name}
                </button>
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
  gridTemplateColumns: '1fr auto',
  gap: 8,
  alignItems: 'center',
};
const draftListStyle: CSSProperties = {display: 'grid', gap: 8};
const draftItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(120px, 0.8fr) 128px minmax(180px, 1.2fr) auto auto',
  gap: 8,
  alignItems: 'center',
  padding: 8,
  border: '1px solid rgba(139,233,253,0.14)',
  borderRadius: 8,
  background: 'rgba(139,233,253,0.04)',
};
const typePillStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 8,
  border: '1px solid rgba(139,233,253,0.18)',
  background: 'rgba(139,233,253,0.08)',
  color: '#8be9fd',
  padding: '8px 9px',
  fontSize: 12,
  fontWeight: 800,
  textAlign: 'center',
};
const lockedRoleStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#9fb3c8',
  padding: '9px 10px',
  fontSize: 13,
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
  borderRadius: 8,
  padding: '4px 8px',
  cursor: 'pointer',
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
