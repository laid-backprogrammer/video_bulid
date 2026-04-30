import type {SceneAsset, SceneAssetDraft, SceneAssetType} from '../types';

export const MEDIA_ACCEPT = [
  '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml',
  '.mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime',
  '.mp3,.wav,.m4a,.aac,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg',
].join(',');

export const createAssetDraftId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createAssetAlias = (name: string) => {
  const cleaned = name
    .normalize('NFKC')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'asset';
};

export const detectAssetType = (file: File): SceneAssetType => {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(name)) return 'audio';
  return 'image';
};

export const assetTypeLabel = (type?: SceneAssetType | string) => (
  type === 'video' ? '视频' : type === 'audio' ? '音频' : '图片'
);

export const assetMention = (asset: Pick<SceneAsset, 'alias' | 'id'>) => `@${asset.alias ?? asset.id}`;

export const draftMention = (draft: Pick<SceneAssetDraft, 'alias' | 'file'>) => `@${draft.alias.replace(/^@+/, '') || createAssetAlias(draft.file.name)}`;

export const createAssetDraft = (file: File): SceneAssetDraft => ({
  id: createAssetDraftId(),
  file,
  assetType: detectAssetType(file),
  alias: createAssetAlias(file.name),
  role: 'render',
  notes: '',
});
