import type {CSSProperties} from 'react';
import {Panel} from '../../components/ui/Panel';
import type {SceneAsset, SceneAssetDraft, SceneAssetRole} from '../../types';

const mediaAccept = [
  '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml',
  '.mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime',
  '.mp3,.wav,.m4a,.aac,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg',
].join(',');

const assetTypeLabel = (type?: string) => (
  type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'
);

const assetUploadGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: 8,
  alignItems: 'center',
};
const draftListStyle: CSSProperties = {display: 'grid', gap: 8, marginTop: 10};
const draftItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(130px, 0.9fr) 132px minmax(180px, 1.2fr) auto',
  gap: 8,
  alignItems: 'center',
  padding: 8,
  border: '1px solid rgba(139,233,253,0.14)',
  borderRadius: 8,
  background: 'rgba(139,233,253,0.04)',
};
const assetListStyle: CSSProperties = {display: 'grid', gap: 8, marginTop: 12};
const assetItemStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: 8,
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.03)',
};
const assetThumbStyle: CSSProperties = {
  width: 68,
  height: 46,
  objectFit: 'cover',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#05070d',
};
const mediaPreviewStyle: CSSProperties = {
  width: 96,
  minWidth: 96,
  height: 54,
  objectFit: 'cover',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#05070d',
};
const audioPreviewStyle: CSSProperties = {
  width: 140,
  minWidth: 140,
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
const smallInputStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#070b16',
  color: '#e6edf3',
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
const emptyStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  minHeight: 160,
  color: '#9fb3c8',
  textAlign: 'center',
  fontSize: 13,
};
const hintStyle: CSSProperties = {color: '#9fb3c8', fontSize: 13};
const mentionStyle: CSSProperties = {color: '#8be9fd', fontWeight: 700};

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

export function SceneAssetsPanel({
  sceneId,
  assets,
  assetDrafts,
  loading,
  disabled,
  onFilesChange,
  onDraftChange,
  onDraftRemove,
  onUpload,
  onDelete,
}: {
  sceneId: string;
  assets: SceneAsset[];
  assetDrafts: SceneAssetDraft[];
  loading: boolean;
  disabled: boolean;
  onFilesChange: (files: FileList | null) => void;
  onDraftChange: (draftId: string, patch: Partial<Pick<SceneAssetDraft, 'alias' | 'role' | 'notes'>>) => void;
  onDraftRemove: (draftId: string) => void;
  onUpload: () => void;
  onDelete: (assetId: string) => void;
}) {
  const controlsDisabled = disabled || loading;
  const fileInputKey = `${sceneId}-${assetDrafts.length}`;

  return (
    <Panel title="媒体素材" subtitle="图片参考 / 图片素材 / 视频 / 音频">
      <div style={assetUploadGridStyle}>
        <input
          key={fileInputKey}
          type="file"
          multiple
          accept={mediaAccept}
          onChange={(e) => onFilesChange(e.target.files)}
          disabled={controlsDisabled}
          style={fileInputStyle}
        />
        <button
          type="button"
          style={buttonStyle('#50fa7b', controlsDisabled || !assetDrafts.length)}
          onClick={onUpload}
          disabled={controlsDisabled || !assetDrafts.length}
        >
          {loading ? '上传中...' : `上传 ${assetDrafts.length || ''}`.trim()}
        </button>
      </div>
      {assetDrafts.length ? (
        <div style={draftListStyle}>
          {assetDrafts.map((draft) => (
            <div key={draft.id} style={draftItemStyle}>
              <span style={typePillStyle}>{assetTypeLabel(draft.assetType)}</span>
              <input
                value={draft.alias}
                onChange={(e) => onDraftChange(draft.id, {alias: e.target.value.replace(/^@+/, '')})}
                placeholder="@素材名"
                disabled={controlsDisabled}
                style={smallInputStyle}
              />
              {draft.assetType === 'image' ? (
                <select
                  value={draft.role}
                  onChange={(e) => onDraftChange(draft.id, {role: e.target.value as SceneAssetRole})}
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
                onChange={(e) => onDraftChange(draft.id, {notes: e.target.value})}
                placeholder="素材说明 / 想让它做什么"
                disabled={controlsDisabled}
                style={smallInputStyle}
              />
              <button
                type="button"
                style={miniButtonStyle('#ff6b6b', controlsDisabled)}
                disabled={controlsDisabled}
                onClick={() => onDraftRemove(draft.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <p style={hintStyle}>图片可设为仅参考或渲染素材；视频和音频默认是插入素材。模型只会使用你在设计/微调要求里 @ 提到的素材。</p>
      {assets.length ? (
        <div style={assetListStyle}>
          {assets.map((asset) => {
            const src = asset.url || (asset.file ? `/${asset.file.replace(/\\/g, '/')}` : '');
            const assetType = asset.assetType ?? 'image';
            return (
              <div key={asset.id} style={assetItemStyle}>
                {src && assetType === 'image' ? <img src={src} alt={asset.name} style={assetThumbStyle} /> : null}
                {src && assetType === 'video' ? <video src={src} muted playsInline style={mediaPreviewStyle} /> : null}
                {src && assetType === 'audio' ? <audio src={src} controls style={audioPreviewStyle} /> : null}
                <div style={{minWidth: 0, flex: 1}}>
                  <div style={{fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {asset.name}
                  </div>
                  <div style={{fontSize: 12, color: '#9fb3c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    <span style={mentionStyle}>@{asset.alias ?? asset.id}</span> · {assetTypeLabel(assetType)} · {asset.role ?? 'both'} · {asset.file}
                  </div>
                  {asset.notes ? <div style={{fontSize: 12, color: '#c8dcff', marginTop: 4}}>{asset.notes}</div> : null}
                </div>
                <button
                  type="button"
                  style={miniButtonStyle('#ff6b6b', disabled)}
                  disabled={disabled}
                  onClick={() => onDelete(asset.id)}
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{...emptyStyle, minHeight: 90}}>当前场景还没有媒体素材。</div>
      )}
    </Panel>
  );
}
