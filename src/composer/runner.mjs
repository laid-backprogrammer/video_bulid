#!/usr/bin/env node
/**
 * 带逐场景进度追踪的 Pipeline 运行器
 *
 * 用法:
 *   node src/composer/runner.mjs              # 运行全部场景
 *   node src/composer/runner.mjs scene1       # 运行单个场景
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {synthesizeLipVoice} from './voice-synthesis.mjs';
import {alignScenes, getAudioDurationFrames} from './voice-alignment.mjs';
import {readJsonFile} from './json-utils.mjs';

const SCRIPT_PATH = 'src/composer/script.json';
const OUT_DIR = 'public';
const SCENE_TAIL_PADDING_SECONDS = 0.2;
const isSceneIncludedInVideo = (scene) => scene?.enabled !== false && String(scene?.text ?? '').trim().length > 0;

// 全局进度状态（供外部查询）
export const globalState = {
  running: false,
  jobId: null,
  startTime: null,
  scenes: [],
  currentSceneIndex: -1,
  currentStep: null,
  logs: [],
  listeners: new Set(),
};

function notify() {
  globalState.listeners.forEach((cb) => cb(snapshot()));
}

export function snapshot() {
  return {
    running: globalState.running,
    jobId: globalState.jobId,
    startTime: globalState.startTime,
    scenes: globalState.scenes.map((s) => ({
      id: s.id,
      text: s.text,
      step: s.step,
      status: s.status,
      error: s.error,
      audioFile: s.audioFile,
      captionsFile: s.captionsFile,
      durationInFrames: s.durationInFrames,
    })),
    currentSceneIndex: globalState.currentSceneIndex,
    currentStep: globalState.currentStep,
  };
}

function log(text) {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  globalState.logs.push(line);
  notify();
  console.log(line);
}

const defaultSceneAudioFile = (sceneId) => path.join(OUT_DIR, 'voiceover', `${sceneId}.mp3`);

const isSceneAudioFile = (sceneId, fileName) => (
  fileName === `${sceneId}.mp3`
  || fileName === `${sceneId}.wav`
  || (
    fileName.startsWith(`${sceneId}.`)
    && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))
    && !fileName.includes('.tmp.')
    && !fileName.includes('.download.')
  )
);

async function latestSceneAudio(sceneId) {
  const dir = path.join(OUT_DIR, 'voiceover');
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
    const filePath = path.join(dir, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat) files.push({filePath, mtimeMs: stat.mtimeMs});
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath ?? null;
}

export function subscribe(cb) {
  globalState.listeners.add(cb);
  cb(snapshot());
  return () => globalState.listeners.delete(cb);
}

export async function runPipeline(targetSceneId = null, options = {}) {
  if (globalState.running) {
    throw new Error('已有 Pipeline 在运行中');
  }

  const forceTts = Boolean(options.forceTts ?? options.force ?? false);

  globalState.running = true;
  globalState.jobId = `${Date.now()}`;
  globalState.startTime = Date.now();
  globalState.logs = [];
  globalState.currentSceneIndex = -1;
  globalState.currentStep = null;

  try {
    const script = await readJsonFile(SCRIPT_PATH);
    const sourceScenes = targetSceneId
      ? script.scenes.filter((s) => s.id === targetSceneId)
      : script.scenes.filter(isSceneIncludedInVideo);
    const scenes = sourceScenes
      .map((s) => ({...s, step: 'pending', status: 'pending', error: null, audioFile: null, captionsFile: null, durationInFrames: null}));

    globalState.scenes = scenes;
    log(`🚀 Pipeline 启动${targetSceneId ? ` (目标: ${targetSceneId})` : ''}，共 ${scenes.length} 个场景，TTS=${forceTts ? '重新生成' : '复用已有音频'}`);

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      globalState.currentSceneIndex = i;
      globalState.currentStep = 'tts';
      scene.step = 'tts';
      scene.status = 'running';
      notify();
      log(`[${scene.id}] ───────────────────────────────`);
      log(`[${scene.id}] 开始 TTS 合成: "${scene.text.slice(0, 40)}${scene.text.length > 40 ? '...' : ''}"`);

      // TTS
      try {
        const latestAudioFile = forceTts ? null : await latestSceneAudio(scene.id);
        const audioFile = latestAudioFile ?? defaultSceneAudioFile(scene.id);

        if (latestAudioFile) {
          log(`[${scene.id}] 音频已存在，跳过 TTS: ${latestAudioFile}`);
          scene.audioFile = audioFile;
        } else {
          const options = {
            tts: true,
            ttsBaseUrl: script.ttsBaseUrl,
            ttsSign: script.ttsSign,
            ttsAudioId: script.ttsAudioId,
            ttsSpeed: script.ttsSpeed ?? 1.0,
            ttsOut: audioFile,
            ttsTimeoutMs: 120000,
            ttsPollIntervalMs: 2000,
          };
          const result = await synthesizeLipVoice(options, scene.text);
          scene.audioFile = result;
          log(`[${scene.id}] ✅ TTS 完成: ${result}`);
        }
        scene.status = 'tts_done';
      } catch (e) {
        scene.status = 'error';
        scene.step = 'tts';
        scene.error = `TTS 失败: ${e.message}`;
        log(`[${scene.id}] ❌ ${scene.error}`);
        notify();
        continue;
      }

      // ASR
      globalState.currentStep = 'asr';
      scene.step = 'asr';
      scene.status = 'running';
      notify();
      log(`[${scene.id}] 开始 ASR 对齐...`);

      try {
        const aligned = await alignScenes(script, [{...scene, audioFile: scene.audioFile}], OUT_DIR + '/captions');
        const result = aligned[0];
        scene.captionsFile = result.captionsFile;
        scene.durationInFrames = result.durationInFrames;
        scene.cues = result.cues ?? [];
        log(`[${scene.id}] ✅ 时间轴对齐完成: ${result.cues.length} 个 segment / ${result.cues.reduce((sum, cue) => sum + (cue.words?.length ?? 0), 0)} 个词`);
        scene.status = 'success';
        scene.step = 'done';
      } catch (e) {
        scene.status = 'error';
        scene.step = 'asr';
        scene.error = `ASR 失败: ${e.message}`;
        log(`[${scene.id}] ❌ ${scene.error}`);
      }

      notify();
    }

    // 写 manifest（保留已有场景，仅更新本次处理的场景）
    let existingScenes = [];
    const manifestPath = path.join(OUT_DIR, 'scenes-manifest.json');
    try {
      const existing = await readJsonFile(manifestPath);
      if (Array.isArray(existing.scenes)) existingScenes = existing.scenes;
    } catch {
      // manifest 不存在则从头创建
    }

    const processedMap = new Map(
      globalState.scenes
        .filter((s) => s.status === 'success')
        .map((s) => [s.id, {
          id: s.id,
          text: s.text,
          audioFile: s.audioFile,
          captionsFile: s.captionsFile,
          durationInFrames: s.durationInFrames + Math.round((script.fps ?? 30) * SCENE_TAIL_PADDING_SECONDS),
          cues: s.cues ?? [],
        }]),
    );

    // 合并：保留未在本次处理范围内的旧场景，用新结果覆盖处理过的场景
    const manifestScenes = script.scenes.filter(isSceneIncludedInVideo);
    const mergedScenes = manifestScenes.map((scene) => {
      if (processedMap.has(scene.id)) return processedMap.get(scene.id);
      const old = existingScenes.find((s) => s.id === scene.id);
      if (old) return old;
      // 兜底：场景完全没有数据时给最小占位
      return {
        id: scene.id,
        text: scene.text,
        audioFile: '',
        captionsFile: '',
        durationInFrames: Math.round((script.fps ?? 30) * 4),
        cues: [],
      };
    });

    const manifest = {fps: script.fps, scenes: mergedScenes};
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    log(`✅ Pipeline 全部完成，manifest 已更新`);
  } catch (e) {
    log(`❌ Pipeline 异常终止: ${e.message}`);
  } finally {
    globalState.running = false;
    globalState.currentStep = null;
    notify();
  }
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  runPipeline(target).then(() => process.exit(0));
}
