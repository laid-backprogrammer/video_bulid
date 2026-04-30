import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {OUTPUT_DIR, rel, resolveFromRoot} from './paths.mjs';
import {listPreviewVideos, outputExists} from './media-store.mjs';
import {buildManifest, buildSceneRenderManifest} from './manifest-service.mjs';

const TRANSITION_DURATION = 15;

const renderState = {
  running: false,
  exitCode: null,
  startTime: null,
  endTime: null,
  outputFile: 'output/video.mp4',
  mode: 'full',
  sceneId: null,
  progress: null,
  logs: [],
  error: null,
};

const appendRenderLog = (line) => {
  renderState.logs.push(line);
  if (renderState.logs.length > 200) renderState.logs.shift();
};

const failRender = (message, exitCode = null) => {
  renderState.running = false;
  renderState.exitCode = exitCode;
  renderState.endTime = Date.now();
  renderState.error = message;
  renderState.progress = {
    ...(renderState.progress ?? {rendered: 0, total: null, encoded: 0, percent: 0}),
    phase: 'failed',
  };
  appendRenderLog(`Render failed: ${message}`);
};

const runRemotionCommand = (args, {phase = 'preflight'} = {}) => new Promise((resolve) => {
  appendRenderLog(`$ ${process.execPath} ${args.join(' ')}`);
  const child = spawn(process.execPath, args, {
    cwd: resolveFromRoot(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const collect = (chunk, target) => {
    const text = chunk.toString();
    if (target === 'stdout') stdout += text;
    if (target === 'stderr') stderr += text;
    text.split(/\r?\n/).filter(Boolean).forEach((line) => appendRenderLog(line));
  };
  child.stdout.on('data', (chunk) => collect(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => collect(chunk, 'stderr'));
  child.on('error', (error) => {
    appendRenderLog(`${phase} process error: ${error.message}`);
    resolve({ok: false, code: null, stdout, stderr: stderr + error.message});
  });
  child.on('close', (code, signal) => {
    resolve({
      ok: code === 0,
      code,
      signal,
      stdout,
      stderr,
    });
  });
});

const sampleFramesForScene = (durationInFrames) => {
  const duration = Math.max(1, Math.floor(Number(durationInFrames) || 1));
  return [...new Set([
    0,
    Math.floor(duration * 0.25),
    Math.floor(duration * 0.5),
    Math.floor(duration * 0.75),
    duration - 1,
  ].map((frame) => Math.max(0, Math.min(duration - 1, frame))))];
};

const fullManifestDuration = (manifest) => {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const sceneFrames = scenes.reduce((sum, scene) => sum + Math.max(1, Math.floor(Number(scene.durationInFrames) || 1)), 0);
  return Math.max(1, sceneFrames - Math.max(0, scenes.length - 1) * TRANSITION_DURATION);
};

async function writeScenePropsFile(scene, fps) {
  const propsFile = path.join(OUTPUT_DIR, `${scene.id}.props.json`);
  await fs.writeFile(propsFile, JSON.stringify({sceneId: scene.id, scenes: [scene], fps}, null, 2), 'utf-8');
  return propsFile;
}

async function preflightSceneRender({sceneId, scene, propsFile, remotionCli}) {
  if (!sceneId || process.env.RENDER_PREFLIGHT === '0') return;
  if (!scene) throw new Error(`Scene ${sceneId} is not in manifest. 请先生成语音/字幕并重建 manifest。`);

  const frames = sampleFramesForScene(scene.durationInFrames);
  appendRenderLog(`Preflight ${sceneId}: checking frames ${frames.join(', ')}`);
  for (const frame of frames) {
    const outputFile = rel('output', `.preflight-${sceneId}-${frame}.png`);
    const args = [remotionCli, 'still', 'PreviewScene', outputFile, '--props', propsFile, '--frame', String(frame)];
    const result = await runRemotionCommand(args, {phase: `preflight frame ${frame}`});
    await fs.rm(resolveFromRoot(outputFile), {force: true}).catch(() => {});
    if (!result.ok) {
      const detail = [
        `本段渲染预检失败：${sceneId} 第 ${frame} 帧无法渲染`,
        result.stderr.trim() || result.stdout.trim() || `Remotion exited with code ${result.code}`,
      ].join('\n').slice(-6000);
      throw new Error(detail);
    }
  }
  appendRenderLog(`Preflight ${sceneId}: OK`);
}

async function preflightManifestScenes({manifest, remotionCli}) {
  if (process.env.RENDER_PREFLIGHT === '0') return;
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) {
    throw new Error('完整视频没有可渲染场景：请至少启用一个有文案且已生成语音/字幕时间轴的场景，或改用“渲染本段预览”。');
  }

  appendRenderLog(`Preflight full render: ${scenes.length} scene(s)`);
  for (const scene of scenes) {
    const propsFile = await writeScenePropsFile(scene, manifest.fps ?? 30);
    try {
      await preflightSceneRender({sceneId: scene.id, scene, propsFile, remotionCli});
    } finally {
      await fs.rm(propsFile, {force: true}).catch(() => {});
    }
  }
}

async function preflightFullComposition({manifest, remotionCli}) {
  if (process.env.RENDER_PREFLIGHT === '0') return;
  const durationInFrames = fullManifestDuration(manifest);
  const frames = sampleFramesForScene(durationInFrames);
  appendRenderLog(`Preflight AgentDiscussion: checking frames ${frames.join(', ')}`);
  for (const frame of frames) {
    const outputFile = rel('output', `.preflight-AgentDiscussion-${frame}.png`);
    const args = [remotionCli, 'still', 'AgentDiscussion', outputFile, '--frame', String(frame)];
    const result = await runRemotionCommand(args, {phase: `preflight full frame ${frame}`});
    await fs.rm(resolveFromRoot(outputFile), {force: true}).catch(() => {});
    if (!result.ok) {
      const detail = [
        `完整视频预检失败：AgentDiscussion 第 ${frame} 帧无法渲染`,
        result.stderr.trim() || result.stdout.trim() || `Remotion exited with code ${result.code}`,
      ].join('\n').slice(-6000);
      throw new Error(detail);
    }
  }
  appendRenderLog('Preflight AgentDiscussion: OK');
}

export async function getRenderStatus() {
  const videoExists = await outputExists(renderState.outputFile);
  const previewVideos = await listPreviewVideos();
  return {
    ...renderState,
    videoExists,
    videoUrl: videoExists ? `/${renderState.outputFile}?t=${renderState.endTime ?? Date.now()}` : null,
    previewVideos,
  };
}

export async function startRender({sceneId = null} = {}) {
  if (renderState.running) {
    const error = new Error('Render is already running');
    error.status = 409;
    error.state = renderState;
    throw error;
  }

  let manifest = null;
  let sceneManifest = null;
  try {
    manifest = await buildManifest();
    if (sceneId) sceneManifest = await buildSceneRenderManifest(sceneId);
    await fs.mkdir(OUTPUT_DIR, {recursive: true});
  } catch (e) {
    failRender(`准备渲染失败：${e.message}`);
    e.state = renderState;
    throw e;
  }

  const mode = sceneId ? 'scene' : 'full';
  const outputFile = sceneId ? rel('output', `${sceneId}.preview.mp4`) : rel('output', 'video.mp4');
  const composition = sceneId ? 'PreviewScene' : 'AgentDiscussion';
  const remotionCli = resolveFromRoot('node_modules', '@remotion', 'cli', 'remotion-cli.js');
  const args = [remotionCli, 'render', composition, outputFile];
  let propsFile = null;
  if (sceneId) {
    propsFile = await writeScenePropsFile(sceneManifest.scene, sceneManifest.fps ?? manifest?.fps ?? 30);
    args.push('--props', propsFile);
  }

  renderState.running = true;
  renderState.exitCode = null;
  renderState.startTime = Date.now();
  renderState.endTime = null;
  renderState.outputFile = outputFile;
  renderState.mode = mode;
  renderState.sceneId = sceneId;
  renderState.progress = {rendered: 0, total: null, encoded: 0, percent: 0, phase: 'starting'};
  renderState.error = null;
  renderState.logs = [];

  await fs.rm(resolveFromRoot(outputFile), {force: true}).catch(() => {});

  try {
    if (sceneId) {
      renderState.progress = {...renderState.progress, phase: 'preflight'};
      await preflightSceneRender({sceneId, scene: sceneManifest.scene, propsFile, remotionCli});
      renderState.progress = {...renderState.progress, phase: 'starting'};
    } else {
      renderState.progress = {...renderState.progress, phase: 'preflight'};
      await preflightManifestScenes({manifest, remotionCli});
      await preflightFullComposition({manifest, remotionCli});
      renderState.progress = {...renderState.progress, phase: 'starting'};
    }
  } catch (error) {
    failRender(error.message || String(error));
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
    error.state = renderState;
    throw error;
  }

  const command = process.execPath;
  let child;
  try {
    appendRenderLog(`$ ${command} ${args.join(' ')}`);
    child = spawn(command, args, {
      cwd: resolveFromRoot(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failRender(`启动渲染进程失败：${error.message}`);
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
    error.state = renderState;
    throw error;
  }

  let renderStdout = '';
  let renderStderr = '';
  const push = (chunk, target) => {
    const text = chunk.toString();
    if (target === 'stdout') renderStdout += text;
    if (target === 'stderr') renderStderr += text;
    text.split(/\r?\n/).filter(Boolean).forEach((line) => {
      const rendered = line.match(/Rendered\s+(\d+)\/(\d+)/i);
      const encoded = line.match(/Encoded\s+(\d+)\/(\d+)/i);
      if (rendered) {
        const current = Number(rendered[1]);
        const total = Number(rendered[2]);
        renderState.progress = {rendered: current, total, encoded: renderState.progress?.encoded ?? 0, percent: Math.round((current / total) * 100), phase: 'rendering'};
      } else if (encoded) {
        const current = Number(encoded[1]);
        const total = Number(encoded[2]);
        renderState.progress = {rendered: total, total, encoded: current, percent: Math.round((current / total) * 100), phase: 'encoding'};
      } else if (/Getting composition/i.test(line)) {
        renderState.progress = {...renderState.progress, phase: 'metadata'};
      } else if (/Bundling/i.test(line)) {
        renderState.progress = {...renderState.progress, phase: 'bundling'};
      }
      appendRenderLog(line);
    });
  };
  child.stdout.on('data', (chunk) => push(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => push(chunk, 'stderr'));
  let settled = false;
  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    failRender(`启动渲染进程失败：${error.message}`);
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
  });
  child.on('close', (code, signal) => {
    if (settled) return;
    settled = true;
    renderState.running = false;
    renderState.exitCode = code;
    renderState.endTime = Date.now();
    renderState.progress = {...renderState.progress, percent: code === 0 ? 100 : renderState.progress?.percent ?? 0, phase: code === 0 ? 'done' : 'failed'};
    if (code !== 0 && !renderState.error) {
      const detail = (renderStderr.trim() || renderStdout.trim()).split(/\r?\n/).slice(-18).join('\n');
      renderState.error = signal
        ? `Render stopped by signal ${signal}${detail ? `\n${detail}` : ''}`
        : `Render exited with code ${code}${detail ? `\n${detail}` : ''}`;
    }
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
  });

  return renderState;
}
