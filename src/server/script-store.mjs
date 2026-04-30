import fs from 'node:fs/promises';
import {readJsonFile} from '../composer/json-utils.mjs';
import {normalizeSceneAssets, sceneAssetsForStorage} from '../composer/scene-assets.mjs';
import {SCRIPT_PATH} from './paths.mjs';

export async function readScript() {
  return readJsonFile(SCRIPT_PATH);
}

export async function writeScript(script) {
  await fs.writeFile(SCRIPT_PATH, JSON.stringify(script, null, 2), 'utf-8');
  return script;
}

export async function findScene(sceneId) {
  const script = await readScript();
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  return {script, scene};
}

export function mergeConfigSceneAssets(nextScript, currentScript) {
  if (!Array.isArray(nextScript?.scenes) || !Array.isArray(currentScript?.scenes)) {
    return nextScript;
  }

  const existingById = new Map(currentScript.scenes.map((scene) => [scene.id, scene]));
  return {
    ...nextScript,
    scenes: nextScript.scenes.map((scene) => {
      const existingScene = existingById.get(scene.id);
      const mergedAssets = new Map();
      for (const asset of sceneAssetsForStorage(existingScene?.assets)) {
        mergedAssets.set(asset.id, asset);
      }
      for (const asset of sceneAssetsForStorage(scene.assets)) {
        mergedAssets.set(asset.id, asset);
      }
      return {
        ...scene,
        enabled: scene.enabled ?? existingScene?.enabled,
        assets: [...mergedAssets.values()],
      };
    }),
  };
}

export async function updateScript(updater) {
  const script = await readScript();
  const nextScript = await updater(script);
  return writeScript(nextScript);
}

export async function updateScene(sceneId, updater) {
  return updateScript(async (script) => {
    const index = script.scenes.findIndex((item) => item.id === sceneId);
    if (index === -1) throw new Error(`Scene not found: ${sceneId}`);
    const nextScenes = [...script.scenes];
    nextScenes[index] = await updater(nextScenes[index], script);
    return {...script, scenes: nextScenes};
  });
}
