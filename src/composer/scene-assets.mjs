import path from 'node:path';

export const SCENE_ASSET_PUBLIC_DIR = 'public/assets/scenes';
export const MAX_SCENE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SCENE_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_SCENE_AUDIO_BYTES = 80 * 1024 * 1024;
export const ALLOWED_SCENE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
export const ALLOWED_SCENE_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
export const ALLOWED_SCENE_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);
export const SCENE_ASSET_TYPES = new Set(['image', 'video', 'audio']);
export const SCENE_ASSET_ROLES = new Set(['render', 'reference', 'both']);
export const DEFAULT_SCENE_ASSET_ROLE = 'both';

export const detectSceneAssetType = (file = {}) => {
  const ext = path.extname(file.filename || file.name || file.file || '').toLowerCase();
  const mimeType = String(file.contentType || file.mimeType || '').toLowerCase();
  if (ALLOWED_SCENE_IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) return 'image';
  if (ALLOWED_SCENE_VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith('video/')) return 'video';
  if (ALLOWED_SCENE_AUDIO_EXTENSIONS.has(ext) || mimeType.startsWith('audio/')) return 'audio';
  return '';
};

export const normalizeAssetType = (asset = {}) => {
  const explicit = String(asset.assetType || asset.mediaType || asset.type || '').trim();
  if (SCENE_ASSET_TYPES.has(explicit)) return explicit;
  return detectSceneAssetType(asset) || 'image';
};

export const normalizeAssetRole = (role, assetType = 'image') => {
  if (assetType !== 'image') return 'render';
  const value = String(role || '').trim();
  return SCENE_ASSET_ROLES.has(value) ? value : DEFAULT_SCENE_ASSET_ROLE;
};

export const toPosixPath = (value = '') => String(value || '')
  .split(/[\\/]+/)
  .filter((part) => part && part !== '.')
  .join('/');

export const hasUnsafePathSegment = (file = '') => toPosixPath(file).split('/').includes('..');

export const normalizePublicAssetPath = (file = '') => toPosixPath(file);

export const toRemotionStaticFilePath = (file = '') => normalizePublicAssetPath(file).replace(/^public\//, '');

export const toPublicUrl = (file = '') => {
  const normalized = normalizePublicAssetPath(file);
  return normalized ? `/${normalized}` : '';
};

export const sanitizeAssetName = (value) => String(value || 'asset')
  .normalize('NFKD')
  .replace(/[^\w.-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'asset';

export const sanitizeAssetAlias = (value, fallback = 'asset') => {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || sanitizeAssetName(fallback).replace(/\.[a-z0-9]+$/i, '');
};

export const assetMentionTags = (asset) => {
  const tags = [
    asset.alias,
    asset.id,
    sanitizeAssetAlias(asset.name, asset.id),
  ].filter(Boolean).map((tag) => `@${tag}`);
  return [...new Set(tags)];
};

export const createSceneAssetId = () => `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const normalizeSceneAsset = (asset, options = {}) => {
  if (!asset?.id || !asset?.file || hasUnsafePathSegment(asset.file)) return null;

  const file = normalizePublicAssetPath(asset.file);
  const assetType = normalizeAssetType({...asset, file});
  const normalized = {
    id: String(asset.id),
    name: String(asset.name || path.basename(file)),
    file,
    assetType,
    alias: sanitizeAssetAlias(asset.alias, asset.name || asset.id),
    role: normalizeAssetRole(asset.role, assetType),
    notes: asset.notes ? String(asset.notes) : '',
    mimeType: asset.mimeType ? String(asset.mimeType) : '',
    size: Number(asset.size || 0),
    uploadedAt: asset.uploadedAt ? String(asset.uploadedAt) : '',
  };

  if (options.includeUrl) {
    normalized.url = toPublicUrl(file);
  }
  if (options.includeStaticFilePath) {
    normalized.staticFilePath = toRemotionStaticFilePath(file);
  }
  if (options.includeAbsolutePath && options.root) {
    normalized.absolutePath = path.resolve(options.root, file);
  }

  return normalized;
};

export const normalizeSceneAssets = (assets = [], options = {}) => Array.isArray(assets)
  ? assets.map((asset) => normalizeSceneAsset(asset, options)).filter(Boolean)
  : [];

export const stripDerivedSceneAsset = (asset) => {
  const normalized = normalizeSceneAsset(asset);
  if (!normalized) return null;
  return normalized;
};

export const sceneAssetsForStorage = (assets = []) => normalizeSceneAssets(assets)
  .map(stripDerivedSceneAsset)
  .filter(Boolean);

export const validateSceneAssetFile = (file) => {
  if (!file) throw new Error('Please provide a media file');

  const ext = path.extname(file.filename).toLowerCase();
  const assetType = detectSceneAssetType(file);
  if (!assetType) {
    throw new Error('Only image (png, jpg, jpeg, webp, svg), video (mp4, webm, mov, m4v), and audio (mp3, wav, m4a, aac, ogg) assets are supported');
  }

  if (assetType === 'image') {
    if (file.buffer.length > MAX_SCENE_IMAGE_BYTES) throw new Error('Image must be smaller than 20MB');
    if (!ALLOWED_SCENE_IMAGE_EXTENSIONS.has(ext)) throw new Error('Only png, jpg, jpeg, webp, and svg images are supported');
    if (!String(file.contentType || '').startsWith('image/') && ext !== '.svg') throw new Error('Uploaded file is not an image');
  }

  if (assetType === 'video') {
    if (file.buffer.length > MAX_SCENE_VIDEO_BYTES) throw new Error('Video must be smaller than 200MB');
    if (!ALLOWED_SCENE_VIDEO_EXTENSIONS.has(ext)) throw new Error('Only mp4, webm, mov, and m4v videos are supported');
    if (!String(file.contentType || '').startsWith('video/') && !['.mov', '.m4v'].includes(ext)) throw new Error('Uploaded file is not a video');
  }

  if (assetType === 'audio') {
    if (file.buffer.length > MAX_SCENE_AUDIO_BYTES) throw new Error('Audio must be smaller than 80MB');
    if (!ALLOWED_SCENE_AUDIO_EXTENSIONS.has(ext)) throw new Error('Only mp3, wav, m4a, aac, and ogg audio files are supported');
    if (!String(file.contentType || '').startsWith('audio/') && !['.m4a', '.aac', '.ogg'].includes(ext)) throw new Error('Uploaded file is not audio');
  }

  return {ext, assetType};
};

export const createSceneAssetRecord = ({sceneId, file, role, notes, alias}) => {
  const {ext, assetType} = validateSceneAssetFile(file);
  const id = createSceneAssetId();
  const safeName = sanitizeAssetName(path.basename(file.filename, ext));
  const storedName = `${id}-${safeName}${ext}`;

  return {
    storedName,
    asset: {
      id,
      name: path.basename(file.filename),
      file: `${SCENE_ASSET_PUBLIC_DIR}/${sceneId}/${storedName}`,
      assetType,
      alias: sanitizeAssetAlias(alias, safeName || id),
      role: normalizeAssetRole(role, assetType),
      notes: String(notes || '').trim(),
      mimeType: file.contentType || '',
      size: file.buffer.length,
      uploadedAt: new Date().toISOString(),
    },
  };
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const assetIsMentioned = (asset, text = '') => {
  const haystack = String(text || '');
  if (!haystack) return false;
  return assetMentionTags(asset).some((tag) => {
    const escaped = escapeRegExp(tag);
    return new RegExp(`(^|[^\\p{Letter}\\p{Number}_-])${escaped}(?=$|[^\\p{Letter}\\p{Number}_-])`, 'u').test(haystack);
  });
};

export const filterMentionedSceneAssets = (assets = [], mentionText = '') => normalizeSceneAssets(assets)
  .filter((asset) => assetIsMentioned(asset, mentionText));

export const buildSceneAssetsMarkdown = (assets = [], options = {}) => {
  const normalized = (options.requireMention
    ? filterMentionedSceneAssets(assets, options.mentionText)
    : normalizeSceneAssets(assets)
  ).map((asset) => normalizeSceneAsset(asset, {
    includeStaticFilePath: true,
    includeAbsolutePath: Boolean(options.root),
    root: options.root,
  })).filter(Boolean);

  if (!normalized.length) {
    return options.requireMention
      ? 'No user-provided media assets were @mentioned in this request. Do not use uploaded media assets for this pass.'
      : 'No user-provided media assets for this scene.';
  }

  return [
    'User-provided media assets available for this pass:',
    '',
    'Asset mention syntax:',
    '- The user must write `@alias` or `@asset_id` to target a specific asset.',
    '- Only use assets listed in this section. Assets not @mentioned are intentionally withheld from this context.',
    '- When a prompt describes an operation near a mention, apply that operation to the matching image/video/audio asset.',
    '- If several mentioned assets appear, arrange them as separate timeline/layer elements instead of merging them into one generic reference.',
    '',
    'Role and type rules:',
    '- Image `reference`: visual reference only. Match style, layout, lighting, product/character look, or page effect; do not render it by default.',
    '- Image `render`: visible image material. Use Remotion `Img` with `staticFile()` unless the user explicitly says not to show it.',
    '- Image `both`: may be displayed as material and also used as a visual reference.',
    '- Video assets default to insertable material. Use Remotion `Video` from `@remotion/media`, usually inside a `Sequence` for timing and layout control.',
    '- Audio assets default to insertable material. Use Remotion `Audio` from `@remotion/media`, usually inside a `Sequence`; this is appropriate for click sounds, whooshes, music beds, or timed SFX.',
    '',
    ...normalized.map((asset, index) => [
      `### ${asset.assetType[0].toUpperCase()}${asset.assetType.slice(1)} ${index + 1}: ${asset.name}`,
      `- id: ${asset.id}`,
      `- assetType: ${asset.assetType}`,
      `- alias: @${asset.alias}`,
      `- mention tags: ${assetMentionTags(asset).join(', ')}`,
      `- role: ${asset.role}`,
      `- public file: ${asset.file}`,
      `- staticFile path: ${asset.staticFilePath}`,
      asset.absolutePath ? `- absolute path for local/CLI inspection: ${asset.absolutePath}` : null,
      asset.notes ? `- user description: ${asset.notes}` : '- user description: (none)',
      asset.assetType === 'image' && asset.role === 'reference'
        ? '- codegen instruction: use as effect/style reference only; do not place this image in the rendered frame.'
        : asset.assetType === 'image'
          ? [
          '- codegen instruction: render this image as a visible Remotion `Img` layer selected from the runtime `assets` prop.',
          `- render example shape: <Img src={staticFile(asset.file.replace(/^public[\\\\/]/, '').replace(/\\\\/g, '/'))} />`,
        ].join('\n')
          : asset.assetType === 'video'
            ? [
              '- codegen instruction: render this video as a visible Remotion `Video` layer selected from the runtime `assets` prop.',
              `- render example shape: <Sequence from={startFrame} durationInFrames={duration}><Video src={staticFile(asset.file.replace(/^public[\\\\/]/, '').replace(/\\\\/g, '/'))} /></Sequence>`,
            ].join('\n')
            : [
              '- codegen instruction: render this audio as a timed Remotion `Audio` layer selected from the runtime `assets` prop.',
              `- render example shape: <Sequence from={startFrame} durationInFrames={duration} layout="none"><Audio src={staticFile(asset.file.replace(/^public[\\\\/]/, '').replace(/\\\\/g, '/'))} /></Sequence>`,
            ].join('\n'),
    ].filter(Boolean).join('\n')),
  ].join('\n');
};
