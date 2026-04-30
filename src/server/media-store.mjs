import fs from 'node:fs/promises';
import path from 'node:path';
import {readJsonFile} from '../composer/json-utils.mjs';
import {OUTPUT_DIR, PUBLIC_DIR, rel} from './paths.mjs';

export const exists = async (filePath) => fs.access(filePath).then(() => true).catch(() => false);

export async function outputExists(filePath) {
  if (!filePath) return false;
  return exists(path.join(path.resolve(OUTPUT_DIR, '..'), filePath));
}

export async function listPreviewVideos() {
  let entries;
  try {
    entries = await fs.readdir(OUTPUT_DIR, {withFileTypes: true});
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }

  const previews = {};
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const match = entry.name.match(/^(scene\d+)\.preview\.mp4$/i);
    if (!match) return;
    const sceneId = match[1];
    const outputFile = rel('output', entry.name);
    const stat = await fs.stat(path.join(OUTPUT_DIR, entry.name)).catch(() => null);
    previews[sceneId] = {
      outputFile,
      videoUrl: `/${outputFile}?t=${Math.round(stat?.mtimeMs ?? Date.now())}`,
      mtimeMs: stat?.mtimeMs ?? null,
    };
  }));
  return previews;
}

export const isSceneAudioFile = (sceneId, fileName) => (
  fileName === `${sceneId}.mp3`
  || fileName === `${sceneId}.wav`
  || (
    fileName.startsWith(`${sceneId}.`)
    && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))
    && !fileName.includes('.tmp.')
    && !fileName.includes('.download.')
  )
);

export async function latestSceneAudio(sceneId) {
  const dir = path.join(PUBLIC_DIR, 'voiceover');
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSceneAudioFile(sceneId, entry.name)) continue;
    const absPath = path.join(dir, entry.name);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat) continue;
    files.push({
      absPath,
      filePath: rel('public', 'voiceover', entry.name),
      relPath: rel('public', 'voiceover', entry.name),
      mtimeMs: stat.mtimeMs,
    });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ?? null;
}

export async function captionData(sceneId) {
  const captionsFile = path.join(PUBLIC_DIR, 'captions', `${sceneId}.json`);
  if (!(await exists(captionsFile))) return null;
  return readJsonFile(captionsFile);
}
