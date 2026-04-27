import path from 'node:path';

export const SCENE_ASSET_PUBLIC_DIR = 'public/assets/scenes';
export const MAX_SCENE_IMAGE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_SCENE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
export const SCENE_ASSET_ROLES = new Set(['render', 'reference', 'both']);
export const DEFAULT_SCENE_ASSET_ROLE = 'both';

export const normalizeAssetRole = (role) => {
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

export const createSceneAssetId = () => `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const normalizeSceneAsset = (asset, options = {}) => {
  if (!asset?.id || !asset?.file || hasUnsafePathSegment(asset.file)) return null;

  const file = normalizePublicAssetPath(asset.file);
  const normalized = {
    id: String(asset.id),
    name: String(asset.name || path.basename(file)),
    file,
    role: normalizeAssetRole(asset.role),
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

export const validateSceneImageFile = (file) => {
  if (!file) throw new Error('Please provide an image file');
  if (file.buffer.length > MAX_SCENE_IMAGE_BYTES) throw new Error('Image must be smaller than 20MB');

  const ext = path.extname(file.filename).toLowerCase();
  if (!ALLOWED_SCENE_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error('Only png, jpg, jpeg, webp, and svg images are supported');
  }
  if (!String(file.contentType || '').startsWith('image/') && ext !== '.svg') {
    throw new Error('Uploaded file is not an image');
  }

  return ext;
};

export const createSceneAssetRecord = ({sceneId, file, role, notes}) => {
  const ext = path.extname(file.filename).toLowerCase();
  const id = createSceneAssetId();
  const safeName = sanitizeAssetName(path.basename(file.filename, ext));
  const storedName = `${id}-${safeName}${ext}`;

  return {
    storedName,
    asset: {
      id,
      name: path.basename(file.filename),
      file: `${SCENE_ASSET_PUBLIC_DIR}/${sceneId}/${storedName}`,
      role: normalizeAssetRole(role),
      notes: String(notes || '').trim(),
      mimeType: file.contentType || '',
      size: file.buffer.length,
      uploadedAt: new Date().toISOString(),
    },
  };
};

export const buildSceneAssetsMarkdown = (assets = [], options = {}) => {
  const normalized = normalizeSceneAssets(assets, {
    includeStaticFilePath: true,
    includeAbsolutePath: Boolean(options.root),
    root: options.root,
  });

  if (!normalized.length) return 'No user-provided images for this scene.';

  return [
    'User-provided images are separated by role:',
    '',
    '- `render`: visible image material. Use Remotion `Img` with `staticFile()` when it supports the scene.',
    '- `reference`: visual reference only. Match style, layout, lighting, product/character look, or page effect; do not render it by default.',
    '- `both`: may be displayed as material and also used as a visual reference.',
    '',
    ...normalized.map((asset, index) => [
      `### Image ${index + 1}: ${asset.name}`,
      `- id: ${asset.id}`,
      `- role: ${asset.role}`,
      `- public file: ${asset.file}`,
      `- staticFile path: ${asset.staticFilePath}`,
      asset.absolutePath ? `- absolute path for local/CLI inspection: ${asset.absolutePath}` : null,
      asset.notes ? `- user notes: ${asset.notes}` : '- user notes: (none)',
      asset.role === 'reference'
        ? '- codegen instruction: use as effect/style reference only; do not place this image in the rendered frame.'
        : `- render example: <Img src={staticFile("${asset.staticFilePath}")} />`,
    ].filter(Boolean).join('\n')),
  ].join('\n');
};
