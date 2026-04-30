import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCENE_ASSET_PUBLIC_DIR} from '../composer/scene-assets.mjs';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPT_PATH = path.join(ROOT_DIR, 'src/composer/script.json');
export const MANIFEST_PATH = path.join(ROOT_DIR, 'public/scenes-manifest.json');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
export const SCENE_ASSET_DIR = path.join(ROOT_DIR, SCENE_ASSET_PUBLIC_DIR);
export const editorDist = path.join(ROOT_DIR, 'editor/dist');

export const rel = (...parts) => path.join(...parts).replace(/\\/g, '/');

export const defaultSceneAudioFile = (sceneId) => rel('public', 'voiceover', `${sceneId}.mp3`);
export const versionedSceneAudioFile = (sceneId, ext = 'mp3') => rel('public', 'voiceover', `${sceneId}.${Date.now()}.${ext}`);
export const resolveFromRoot = (...parts) => path.join(ROOT_DIR, ...parts);
export const audioUrl = (audioFile) => `/${audioFile.replace(/\\/g, '/')}`;
export const isSceneIncludedInVideo = (scene) => scene?.enabled !== false && String(scene?.text ?? '').trim().length > 0;
