import type {CSSProperties} from 'react';
import type {AgentAssetIntent, AgentAttachmentDraft, SceneAsset, SceneItem} from '../types';

type IntentOption = [AgentAssetIntent, string];

const assetMention = (asset: Pick<SceneAsset, 'alias' | 'id'>) => `@${asset.alias || asset.id}`;
const assetPreviewUrl = (asset: SceneAsset) => (
  asset.url || (asset.file ? `/${asset.file.replace(/^public[\\/]/, '').replace(/\\/g, '/')}` : '')
);

export function SceneAssetsDrawer({
  scene,
  drafts,
  intentOptions,
  disabled,
  onUpdateIntent,
  onUpdateNotes,
  onRemoveDraft,
  onInsertMention,
}: {
  scene: SceneItem | null;
  drafts: AgentAttachmentDraft[];
  intentOptions: IntentOption[];
  disabled: boolean;
  onUpdateIntent: (id: string, intent: AgentAssetIntent) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onRemoveDraft: (id: string) => void;
  onInsertMention: (mention: string) => void;
}) {
  const savedAssets = scene?.assets ?? [];

  return (
    <div style={wrapStyle}>
      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>
          <strong>{scene?.id ?? '未选择'} 已入库素材</strong>
          <span>{savedAssets.length} 个</span>
        </div>
        {savedAssets.length ? savedAssets.map((asset) => (
          <SavedAssetRow key={asset.id} asset={asset} onInsertMention={onInsertMention} />
        )) : (
          <div style={emptyStyle}>当前段还没有入库素材。</div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>
          <strong>待写入当前段</strong>
          <span>{drafts.length} 个</span>
        </div>
        {drafts.length ? drafts.map((item) => (
          <article key={item.id} style={draftCardStyle}>
            <div style={{minWidth: 0}}>
              <strong>{item.fileName}</strong>
              <p style={mutedStyle}>{item.kind} · {(item.size / 1024 / 1024).toFixed(2)}MB · @{item.alias}</p>
            </div>
            <button
              type="button"
              style={mentionButtonStyle}
              aria-label={`插入 @${item.alias}`}
              title={`插入 @${item.alias}`}
              onClick={() => onInsertMention(`@${item.alias}`)}
            >
              引用
            </button>
            <select value={item.inferredIntent} onChange={(event) => onUpdateIntent(item.id, event.target.value as AgentAssetIntent)} style={selectStyle} disabled={disabled}>
              {intentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={item.notes} onChange={(event) => onUpdateNotes(item.id, event.target.value)} style={assetInputStyle} disabled={disabled} />
            <button type="button" style={removeButtonStyle} disabled={disabled} onClick={() => onRemoveDraft(item.id)}>
              移除
            </button>
          </article>
        )) : (
          <div style={emptyStyle}>点击输入框左下角 +，素材会先挂到当前段。</div>
        )}
      </section>
    </div>
  );
}

function SavedAssetRow({
  asset,
  onInsertMention,
}: {
  asset: SceneAsset;
  onInsertMention: (mention: string) => void;
}) {
  const mention = assetMention(asset);
  const previewUrl = asset.assetType === 'image' ? assetPreviewUrl(asset) : '';
  return (
    <article style={savedRowStyle}>
      {previewUrl ? (
        <img src={previewUrl} alt="" style={thumbStyle} />
      ) : (
        <div style={thumbFallbackStyle}>{String(asset.assetType || 'asset').slice(0, 1).toUpperCase()}</div>
      )}
      <div style={{minWidth: 0}}>
        <strong>{asset.alias ? `@${asset.alias}` : asset.id}</strong>
        <p style={mutedStyle}>{asset.assetType || 'asset'} · {asset.role || 'render'} · {asset.name}</p>
        {asset.notes ? <p style={notesStyle}>{asset.notes}</p> : null}
      </div>
      <button
        type="button"
        style={mentionButtonStyle}
        aria-label={`插入 ${mention}`}
        title={`插入 ${mention}`}
        onClick={() => onInsertMention(mention)}
      >
        引用
      </button>
    </article>
  );
}

const wrapStyle: CSSProperties = {display: 'grid', gap: 12, padding: 14};
const sectionStyle: CSSProperties = {display: 'grid', gap: 9};
const sectionHeadStyle: CSSProperties = {display: 'flex', justifyContent: 'space-between', color: '#d8d8d8', fontSize: 13};
const savedRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '52px minmax(0, 1fr) auto',
  gap: 10,
  alignItems: 'center',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 10,
  padding: 10,
  background: '#202020',
};
const thumbStyle: CSSProperties = {width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: '#111'};
const thumbFallbackStyle: CSSProperties = {width: 52, height: 52, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)', background: '#151515', color: '#8c8c8c', fontWeight: 900};
const draftCardStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 10,
  padding: 10,
  background: '#202020',
};
const mutedStyle: CSSProperties = {margin: '4px 0 0', color: '#8c8c8c', fontSize: 12, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'};
const notesStyle: CSSProperties = {margin: '5px 0 0', color: '#b8b8b8', fontSize: 12, lineHeight: 1.45};
const mentionButtonStyle: CSSProperties = {border: '1px solid rgba(255,255,255,0.12)', background: '#2a2a2a', color: '#eee', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 800};
const selectStyle: CSSProperties = {minWidth: 0, border: '1px solid rgba(255,255,255,0.12)', background: '#111', color: '#eee', borderRadius: 8, padding: 8};
const assetInputStyle: CSSProperties = {gridColumn: '1 / span 2', minWidth: 0, border: '1px solid rgba(255,255,255,0.12)', background: '#111', color: '#eee', borderRadius: 8, padding: 8};
const removeButtonStyle: CSSProperties = {border: '1px solid rgba(255,107,107,0.28)', background: 'rgba(255,107,107,0.10)', color: '#ff9999', borderRadius: 8, padding: 8, cursor: 'pointer'};
const emptyStyle: CSSProperties = {minHeight: 74, display: 'grid', placeItems: 'center', color: '#888', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.10)', borderRadius: 10};
