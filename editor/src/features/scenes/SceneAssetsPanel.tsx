import type {CSSProperties} from 'react';
import {Panel} from '../../components/ui/Panel';
import type {SceneAsset, SceneAssetRole} from '../../types';

const assetUploadGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 150px 1fr auto',
  gap: 8,
  alignItems: 'center',
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
  assetFile,
  assetRole,
  assetNotes,
  loading,
  disabled,
  onFileChange,
  onRoleChange,
  onNotesChange,
  onUpload,
  onDelete,
}: {
  sceneId: string;
  assets: SceneAsset[];
  assetFile: File | null;
  assetRole: SceneAssetRole;
  assetNotes: string;
  loading: boolean;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onRoleChange: (role: SceneAssetRole) => void;
  onNotesChange: (notes: string) => void;
  onUpload: () => void;
  onDelete: (assetId: string) => void;
}) {
  const controlsDisabled = disabled || loading;
  const fileInputKey = assetFile ? `${assetFile.name}-${assetFile.size}` : `${sceneId}-empty`;

  return (
    <Panel title="图片素材" subtitle="渲染素材 / 视觉参考">
      <div style={assetUploadGridStyle}>
        <input
          key={fileInputKey}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          disabled={controlsDisabled}
          style={fileInputStyle}
        />
        <select
          value={assetRole}
          onChange={(e) => onRoleChange(e.target.value as SceneAssetRole)}
          disabled={controlsDisabled}
          style={smallInputStyle}
        >
          <option value="reference">仅参考</option>
          <option value="render">渲染素材</option>
          <option value="both">两者都是</option>
        </select>
        <input
          value={assetNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="给设计/代码生成的素材说明"
          disabled={controlsDisabled}
          style={smallInputStyle}
        />
        <button
          type="button"
          style={buttonStyle('#50fa7b', controlsDisabled || !assetFile)}
          onClick={onUpload}
          disabled={controlsDisabled || !assetFile}
        >
          {loading ? '上传中...' : '上传'}
        </button>
      </div>
      <p style={hintStyle}>渲染素材可进入 Remotion 画面；仅参考图片只作为风格、构图或效果参考传给设计和代码生成。</p>
      {assets.length ? (
        <div style={assetListStyle}>
          {assets.map((asset) => {
            const src = asset.url || (asset.file ? `/${asset.file.replace(/\\/g, '/')}` : '');
            return (
              <div key={asset.id} style={assetItemStyle}>
                {src ? <img src={src} alt={asset.name} style={assetThumbStyle} /> : null}
                <div style={{minWidth: 0, flex: 1}}>
                  <div style={{fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {asset.name}
                  </div>
                  <div style={{fontSize: 12, color: '#9fb3c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {asset.role ?? 'both'} · {asset.file}
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
        <div style={{...emptyStyle, minHeight: 90}}>当前场景还没有图片素材。</div>
      )}
    </Panel>
  );
}
