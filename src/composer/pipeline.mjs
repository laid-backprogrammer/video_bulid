#!/usr/bin/env node
/**
 * 一键 Pipeline：文案 → TTS 语音 → ASR 对齐 → 输出场景数据
 *
 * 用法:
 *   node src/composer/pipeline.mjs
 *
 * 环境变量:
 *   OPENAI_API_KEY  - 用于 Whisper ASR 对齐（可选，未设置则用文案估算）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {synthesizeScenes} from './voice-synthesis.mjs';
import {alignScenes} from './voice-alignment.mjs';
import {readJsonFile} from './json-utils.mjs';

const SCRIPT_PATH = 'src/composer/script.json';
const MANIFEST_PATH = 'public/scenes-manifest.json';

async function main() {
  console.log('读取文案配置...');
  const script = await readJsonFile(SCRIPT_PATH);

  console.log(`\n=== 阶段 1/2: TTS 语音合成 (${script.scenes.length} 个场景) ===`);
  const scenesWithAudio = await synthesizeScenes(script);

  console.log(`\n=== 阶段 2/2: ASR 语音对齐 ===`);
  const scenesAligned = await alignScenes(script, scenesWithAudio);

  const manifest = {
    fps: script.fps,
    scenes: scenesAligned.map((s) => ({
      id: s.id,
      text: s.text,
      audioFile: s.audioFile,
      captionsFile: s.captionsFile,
      durationInFrames: s.durationInFrames,
    })),
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Pipeline 完成！总时长: ${manifest.scenes.reduce((sum, s) => sum + s.durationInFrames, 0)} 帧 (~${(manifest.scenes.reduce((sum, s) => sum + s.durationInFrames, 0) / script.fps).toFixed(1)}s)`);
  console.log(`📄 场景清单: ${path.resolve(MANIFEST_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
