import fs from 'node:fs/promises';
import path from 'node:path';
import {readJsonFile} from '../composer/json-utils.mjs';
import {currentSceneAssetMentionText, filterMentionedSceneAssets, normalizeSceneAssets} from '../composer/scene-assets.mjs';
import {getAudioDurationFrames} from '../composer/voice-alignment.mjs';
import {MANIFEST_PATH, PUBLIC_DIR, rel, isSceneIncludedInVideo} from './paths.mjs';
import {exists, latestSceneAudio} from './media-store.mjs';
import {readScript} from './script-store.mjs';

const SCENE_TAIL_PADDING_SECONDS = 0.2;

async function sceneToManifestEntry(scene, script) {
  const audio = await latestSceneAudio(scene.id);
  const audioFile = audio?.relPath ?? '';
  const captionsFile = rel('public', 'captions', `${scene.id}.json`);
  const captionPath = path.join(PUBLIC_DIR, 'captions', `${scene.id}.json`);
  const cap = (await exists(captionPath)) ? await readJsonFile(captionPath) : null;
  const baseDurationInFrames = cap?.durationInFrames
    ?? (audio ? await getAudioDurationFrames(audioFile, script.fps) : null)
    ?? script.fps * 4;
  const durationInFrames = baseDurationInFrames + Math.round((script.fps ?? 30) * SCENE_TAIL_PADDING_SECONDS);

  if (!audio && !cap) return null;

  return {
    id: scene.id,
    text: scene.text,
    audioFile,
    captionsFile,
    durationInFrames,
    cues: cap?.cues ?? [],
    assets: normalizeSceneAssets(filterMentionedSceneAssets(
      scene.assets,
      currentSceneAssetMentionText(scene),
    )),
    enabled: scene.enabled !== false,
  };
}

export async function buildSceneRenderManifest(sceneId) {
  const script = await readScript();
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  if (!String(scene.text ?? '').trim()) throw new Error(`${sceneId} 没有文案，无法渲染本段。`);

  const entry = await sceneToManifestEntry(scene, script);
  if (!entry) {
    throw new Error(`${sceneId} 没有可用语音或字幕时间轴，请先运行语音/时间轴对齐。`);
  }

  return {
    fps: script.fps,
    scene: {
      ...entry,
      enabled: true,
    },
  };
}

export async function buildManifest() {
  const script = await readScript();
  const scenes = [];

  for (const scene of script.scenes.filter(isSceneIncludedInVideo)) {
    const entry = await sceneToManifestEntry(scene, script);
    if (entry) scenes.push(entry);
  }

  const manifest = {fps: script.fps, scenes};
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}
