#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runPipeline, globalState, subscribe, snapshot} from './src/composer/runner.mjs';
import {readJsonFile} from './src/composer/json-utils.mjs';
import {synthesizeLipVoice} from './src/composer/voice-synthesis.mjs';
import {alignScenes, getAudioDurationFrames} from './src/composer/voice-alignment.mjs';
import {runSceneAgent} from './src/composer/scene-agent.mjs';
import {
  buildSceneAssetsMarkdown,
  createSceneAssetRecord,
  normalizeAssetRole,
  normalizeSceneAssets,
  SCENE_ASSET_PUBLIC_DIR,
  sceneAssetsForStorage,
  validateSceneImageFile,
} from './src/composer/scene-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));

const SCRIPT_PATH = path.join(__dirname, 'src/composer/script.json');
const MANIFEST_PATH = path.join(__dirname, 'public/scenes-manifest.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_DIR = path.join(__dirname, 'output');
const SCENE_ASSET_DIR = path.join(__dirname, SCENE_ASSET_PUBLIC_DIR);
const editorDist = path.join(__dirname, 'editor/dist');
const SCENE_TAIL_PADDING_SECONDS = 1;

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

const ttsState = {
  running: false,
  mode: null,
  sceneId: null,
  currentSceneId: null,
  currentIndex: 0,
  total: 0,
  done: 0,
  step: 'idle',
  message: '未开始',
  taskId: null,
  providerStatus: null,
  outputFile: null,
  startedAt: null,
  endTime: null,
  error: null,
  logs: [],
};

const codegenState = {
  running: false,
  sceneId: null,
  provider: null,
  step: 'idle',
  message: '未开始',
  startTime: null,
  endTime: null,
  targetFile: null,
  error: null,
  result: null,
  logs: [],
};

const appendCodegenLog = (message) => {
  codegenState.logs = [
    ...codegenState.logs.slice(-399),
    `[${new Date().toLocaleTimeString()}] ${message}`,
  ];
};

const codegenSnapshot = () => ({
  ...codegenState,
  logs: [...codegenState.logs],
  result: codegenState.result ? {...codegenState.result} : null,
});

const appendTtsLog = (message) => {
  ttsState.logs = [
    ...ttsState.logs.slice(-119),
    `[${new Date().toLocaleTimeString()}] ${message}`,
  ];
};

const updateTtsState = (patch, logMessage = null) => {
  Object.assign(ttsState, patch);
  if (logMessage) appendTtsLog(logMessage);
};

const createTtsProgress = (sceneId) => (event) => {
  updateTtsState({
    currentSceneId: sceneId,
    step: event.stage ?? ttsState.step,
    message: event.message ?? ttsState.message,
    taskId: event.taskId ?? ttsState.taskId,
    providerStatus: event.status ?? ttsState.providerStatus,
    outputFile: event.outputFile ?? ttsState.outputFile,
  }, `${sceneId}: ${event.message ?? event.stage ?? 'TTS 更新'}`);
};

async function outputExists(filePath) {
  if (!filePath) return false;
  return fs.access(path.join(__dirname, filePath)).then(() => true).catch(() => false);
}

const rel = (...parts) => path.join(...parts).replace(/\\/g, '/');
const exists = async (filePath) => fs.access(filePath).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultSceneAudioFile = (sceneId) => rel('public', 'voiceover', `${sceneId}.mp3`);
const versionedSceneAudioFile = (sceneId) => rel('public', 'voiceover', `${sceneId}.${Date.now()}.mp3`);
const audioUrl = (audioFile) => `/${audioFile.replace(/\\/g, '/')}`;

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
      relPath: rel('public', 'voiceover', entry.name),
      mtimeMs: stat.mtimeMs,
    });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ?? null;
}

async function readScript() {
  return readJsonFile(SCRIPT_PATH);
}

async function findScene(sceneId) {
  const script = await readScript();
  const scene = script.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  return {script, scene};
}

async function captionData(sceneId) {
  const captionsFile = path.join(PUBLIC_DIR, 'captions', `${sceneId}.json`);
  if (!(await exists(captionsFile))) return null;
  return readJsonFile(captionsFile);
}

async function buildManifest() {
  const script = await readScript();
  const scenes = [];

  for (const scene of script.scenes) {
    const audio = await latestSceneAudio(scene.id);
    const audioFile = audio?.relPath ?? defaultSceneAudioFile(scene.id);
    const captionsFile = rel('public', 'captions', `${scene.id}.json`);
    const captionPath = path.join(__dirname, captionsFile);
    const cap = (await exists(captionPath)) ? await readJsonFile(captionPath) : null;
    const baseDurationInFrames = cap?.durationInFrames
      ?? (audio ? await getAudioDurationFrames(audioFile, script.fps) : null)
      ?? script.fps * 4;
    const durationInFrames = baseDurationInFrames + Math.round((script.fps ?? 30) * SCENE_TAIL_PADDING_SECONDS);

    if (audio || cap) {
      scenes.push({
        id: scene.id,
        text: scene.text,
        audioFile,
        captionsFile,
        durationInFrames,
        cues: cap?.cues ?? [],
        assets: normalizeSceneAssets(scene.assets),
      });
    }
  }

  const manifest = {fps: script.fps, scenes};
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

async function getScenesStatus() {
  const script = await readScript();
  const scenes = await Promise.all(script.scenes.map(async (scene) => {
    const audio = await latestSceneAudio(scene.id);
    const captionPath = path.join(PUBLIC_DIR, 'captions', `${scene.id}.json`);
    const audioExists = Boolean(audio);
    const captionExists = await exists(captionPath);
    const cap = captionExists ? await readJsonFile(captionPath).catch(() => null) : null;
    const durationMs = cap?.durationInFrames ? Math.round((cap.durationInFrames / script.fps) * 1000) : null;
    return {
      ...scene,
      audioExists,
      captionExists,
      durationMs,
      audioUrl: audio ? audioUrl(audio.relPath) : null,
      captionsUrl: captionExists ? `/public/captions/${scene.id}.json` : null,
      designNotes: scene.designNotes || '',
      tuningNotes: scene.tuningNotes || '',
      assets: normalizeSceneAssets(scene.assets, {includeUrl: true}),
    };
  }));
  return {fps: script.fps, scenes};
}

const secondsFromFrames = (frames, fps) => Number((Number(frames || 0) / Number(fps || 30)).toFixed(3));

const sceneTimingPrompt = async (sceneId) => {
  const script = await readScript();
  const fps = script.fps ?? 30;
  const captions = await captionData(sceneId).catch(() => null);
  if (!captions?.durationInFrames) {
    return {
      durationSeconds: null,
      summary: 'No aligned caption timing is available yet.',
    };
  }

  const cues = Array.isArray(captions.cues) ? captions.cues : [];
  const durationSeconds = secondsFromFrames(captions.durationInFrames, fps);
  const cueLines = cues.map((cue, index) => {
    const start = secondsFromFrames(cue.startFrame, fps);
    const end = secondsFromFrames(cue.endFrame, fps);
    const words = (cue.words ?? []).map((word) => (
      `${word.text}@${secondsFromFrames(word.startFrame, fps)}-${secondsFromFrames(word.endFrame, fps)}s`
    )).join(' ');
    return [
      `cue ${index + 1}: ${start}-${end}s (${cue.startFrame}-${cue.endFrame}f)`,
      `text: ${cue.text}`,
      `chunks: ${words || '(none)'}`,
    ].join('\n');
  }).join('\n\n');

  return {
    durationSeconds,
    summary: [
      `fps: ${fps}`,
      `duration: ${durationSeconds}s (${captions.durationInFrames} frames)`,
      `alignmentSource: ${captions.alignmentSource ?? 'unknown'}`,
      `wordTimingSource: ${captions.wordTimingSource ?? 'unknown'}`,
      '',
      cueLines,
    ].join('\n'),
  };
};

const sceneAssetsPrompt = async (sceneId) => {
  const {scene} = await findScene(sceneId);
  return buildSceneAssetsMarkdown(scene.assets);
};

app.get('/api/config', async (req, res) => {
  try {
    res.json(await readScript());
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/config', async (req, res) => {
  try {
    await fs.writeFile(SCRIPT_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({success: true, config: req.body});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

const parseContentDisposition = (value = '') => {
  const result = {};
  for (const part of value.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey.toLowerCase()] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  }
  return result;
};

const parseMultipartBody = (buffer, contentType) => {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  const files = {};
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (buffer.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString('utf8');
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let content = buffer.slice(headerEnd + 4, nextBoundary);
    if (content.slice(-2).toString('latin1') === '\r\n') content = content.slice(0, -2);

    const disposition = parseContentDisposition(headers['content-disposition']);
    if (disposition.name) {
      if (disposition.filename) {
        files[disposition.name] = {
          filename: path.basename(disposition.filename),
          contentType: headers['content-type'] || 'application/octet-stream',
          buffer: content,
        };
      } else {
        fields[disposition.name] = content.toString('utf8');
      }
    }

    cursor = nextBoundary;
  }

  return {fields, files};
};

const uploadLipVoiceReference = async ({baseUrl, sign, file, name, describe}) => {
  const form = new FormData();
  form.append('file', new Blob([file.buffer], {type: file.contentType}), file.filename);
  form.append('name', name);
  if (describe) form.append('describe', describe);

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/third/reference/upload`, {
    method: 'POST',
    headers: {sign},
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`模型创建失败：HTTP ${response.status} ${text}`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`模型创建失败：响应不是 JSON：${text.slice(0, 300)}`);
  }
  if (payload.code !== 0) throw new Error(`模型创建失败：${payload.msg ?? `code=${payload.code}`}`);
  if (!payload.data?.audioId) throw new Error('模型创建失败：响应缺少 audioId');
  return payload.data;
};

app.post('/api/tts/clone', express.raw({type: 'multipart/form-data', limit: '55mb'}), async (req, res) => {
  try {
    const script = await readScript();
    const {fields, files} = parseMultipartBody(req.body, req.headers['content-type']);
    const file = files.file;
    const name = String(fields.name || '').trim();
    const describe = String(fields.describe || '').trim();

    if (!script.ttsBaseUrl) throw new Error('缺少 ttsBaseUrl');
    if (!script.ttsSign) throw new Error('缺少 ttsSign');
    if (!file) throw new Error('请提供参考音频文件');
    if (!name) throw new Error('请提供模型名称');
    if (!/\.(mp3|wav|m4a)$/i.test(file.filename)) throw new Error('参考音频只支持 mp3、wav、m4a');
    if (file.buffer.length > 50 * 1024 * 1024) throw new Error('参考音频不能超过 50MB');

    const data = await uploadLipVoiceReference({
      baseUrl: script.ttsBaseUrl,
      sign: script.ttsSign,
      file,
      name,
      describe,
    });

    const nextScript = {
      ...script,
      ttsAudioId: data.audioId,
      ttsVoiceName: data.name,
      ttsVoiceDescribe: data.describe,
    };
    await fs.writeFile(SCRIPT_PATH, JSON.stringify(nextScript, null, 2), 'utf-8');
    res.json({success: true, data, config: nextScript});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.post('/api/scene/assets', express.raw({type: 'multipart/form-data', limit: '22mb'}), async (req, res) => {
  try {
    const script = await readScript();
    const {fields, files} = parseMultipartBody(req.body, req.headers['content-type']);
    const sceneId = String(fields.sceneId || '').trim();
    if (!/^scene\d+$/i.test(sceneId)) throw new Error('sceneId must look like scene1, scene2, ...');
    const role = normalizeAssetRole(fields.role);
    const notes = String(fields.notes || '').trim();
    const file = files.file;
    const sceneIndex = script.scenes.findIndex((item) => item.id === sceneId);
    if (sceneIndex === -1) throw new Error(`Scene not found: ${sceneId}`);
    validateSceneImageFile(file);

    const {asset, storedName} = createSceneAssetRecord({sceneId, file, role, notes});
    const assetDir = path.join(SCENE_ASSET_DIR, sceneId);
    await fs.mkdir(assetDir, {recursive: true});
    const assetPath = path.join(assetDir, storedName);
    await fs.writeFile(assetPath, file.buffer);

    const nextScenes = script.scenes.map((scene, index) => (
      index === sceneIndex
        ? {...scene, assets: [...sceneAssetsForStorage(scene.assets), asset]}
        : scene
    ));
    const nextScript = {...script, scenes: nextScenes};
    await fs.writeFile(SCRIPT_PATH, JSON.stringify(nextScript, null, 2), 'utf-8');
    await buildManifest().catch(() => {});
    res.json({success: true, asset: normalizeSceneAssets([asset], {includeUrl: true})[0], config: nextScript});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.post('/api/scene/assets/delete', async (req, res) => {
  try {
    const sceneId = String(req.body?.sceneId || '').trim();
    const assetId = String(req.body?.assetId || '').trim();
    if (!/^scene\d+$/i.test(sceneId)) throw new Error('sceneId must look like scene1, scene2, ...');
    const script = await readScript();
    const sceneIndex = script.scenes.findIndex((item) => item.id === sceneId);
    if (sceneIndex === -1) throw new Error(`Scene not found: ${sceneId}`);
    const assets = normalizeSceneAssets(script.scenes[sceneIndex].assets);
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset not found: ${assetId}`);

    const absAssetPath = path.resolve(__dirname, asset.file);
    const allowedRoot = path.resolve(SCENE_ASSET_DIR, String(sceneId));
    const relativeAssetPath = path.relative(allowedRoot, absAssetPath);
    if (relativeAssetPath.startsWith('..') || path.isAbsolute(relativeAssetPath)) {
      throw new Error('Refusing to delete asset outside scene asset directory');
    }
    await fs.unlink(absAssetPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });

    const nextScenes = script.scenes.map((scene, index) => (
      index === sceneIndex
        ? {...scene, assets: sceneAssetsForStorage(assets.filter((item) => item.id !== assetId))}
        : scene
    ));
    const nextScript = {...script, scenes: nextScenes};
    await fs.writeFile(SCRIPT_PATH, JSON.stringify(nextScript, null, 2), 'utf-8');
    await buildManifest().catch(() => {});
    res.json({success: true, config: nextScript});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.get('/api/scenes', async (req, res) => {
  try {
    res.json(await getScenesStatus());
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.get('/api/manifest', async (req, res) => {
  try {
    res.json(await readJsonFile(MANIFEST_PATH));
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/manifest/rebuild', async (req, res) => {
  console.log('[api/manifest/rebuild] start');
  try {
    res.json({success: true, manifest: await buildManifest()});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

async function getLlmApiKey() {
  try {
    const script = await readJsonFile(SCRIPT_PATH);
    return script.llmApiKey || script.transcribeApiKey || process.env.OPENAI_API_KEY || null;
  } catch {
    return process.env.OPENAI_API_KEY || null;
  }
}

async function llmChat(system, user, model) {
  const settings = await getLlmSettings();
  if (!settings.apiKey) throw new Error('未配置 LLM API Key（script.llmApiKey、script.transcribeApiKey 或环境变量 OPENAI_API_KEY）');

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: model || settings.model,
      messages: [
        {role: 'system', content: system},
        {role: 'user', content: user},
      ],
      temperature: 0.7,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data.choices?.[0]?.message?.content || '';
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function getLlmSettings() {
  const script = await readJsonFile(SCRIPT_PATH).catch(() => ({}));
  const apiKey = script.llmApiKey || script.transcribeApiKey || process.env.OPENAI_API_KEY || null;
  let baseUrl = (
    process.env.OPENAI_BASE_URL
    || script.llmBaseUrl
    || script.transcribeBaseUrl
    || 'https://api.openai.com'
  ).replace(/\/$/, '');
  if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);
  return {
    apiKey,
    baseUrl,
    model: script.llmModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

async function streamFallbackText(res, fallback, provider = 'fallback') {
  sendSse(res, 'status', {message: '未配置 LLM API Key，使用本地兜底内容', provider});
  const chunks = fallback.match(/.{1,18}/gs) ?? [fallback];
  let text = '';
  for (const chunk of chunks) {
    text += chunk;
    sendSse(res, 'token', {delta: chunk, text, provider});
    await sleep(35);
  }
  sendSse(res, 'done', {text, thinking: '', provider});
  return {text, thinking: '', provider};
}

async function streamNonStreamingChat(res, settings, selectedModel, system, user, reasonText = '') {
  sendSse(res, 'status', {
    message: reasonText ? '流式响应不可用，切换为普通响应' : '使用普通响应生成 LLM 内容',
    provider: 'openai',
    model: selectedModel,
  });

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [
        {role: 'system', content: system},
        {role: 'user', content: user},
      ],
      temperature: 0.7,
    }),
  });

  const payloadText = await response.text();
  let data = null;
  try {
    data = payloadText ? JSON.parse(payloadText) : null;
  } catch {}
  if (!response.ok) {
    const message = data?.error?.message || payloadText || response.statusText;
    throw new Error(`LLM 请求失败（model=${selectedModel}）：${message}`);
  }

  const fullText = data?.choices?.[0]?.message?.content || '';
  const chunks = fullText.match(/.{1,24}/gs) ?? [fullText];
  let text = '';
  for (const chunk of chunks) {
    text += chunk;
    sendSse(res, 'token', {delta: chunk, text, provider: 'openai'});
    await sleep(20);
  }
  sendSse(res, 'done', {text, thinking: '', provider: 'openai'});
  return {text, thinking: '', provider: 'openai'};
}

async function streamLlmChat(res, {system, user, fallback, model}) {
  const settings = await getLlmSettings();
  if (!settings.apiKey) {
    return streamFallbackText(res, fallback);
  }

  const selectedModel = model || settings.model;
  sendSse(res, 'status', {
    message: '已连接 LLM，等待流式响应',
    provider: 'openai',
    model: selectedModel,
  });

  const requestBody = {
    model: selectedModel,
    messages: [
      {role: 'system', content: system},
      {role: 'user', content: user},
    ],
    temperature: 0.7,
    stream: true,
  };

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (/unsupported|not support|stream/i.test(errorText)) {
      return streamNonStreamingChat(res, settings, selectedModel, system, user, errorText);
    }
    throw new Error(`LLM 请求失败（model=${selectedModel}）：${errorText}`);
  }
  if (!response.body) {
    throw new Error('LLM response has no stream body');
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let thinking = '';

  const consumeLine = (line) => {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;

    const data = JSON.parse(payload);
    const delta = data.choices?.[0]?.delta ?? {};
    const thinkingDelta = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? '';
    const contentDelta = delta.content ?? '';

    if (thinkingDelta) {
      thinking += thinkingDelta;
      sendSse(res, 'thinking', {delta: thinkingDelta, text: thinking});
    }
    if (contentDelta) {
      text += contentDelta;
      sendSse(res, 'token', {delta: contentDelta, text});
    }
    return false;
  };

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (consumeLine(line)) {
        sendSse(res, 'done', {text, thinking, provider: 'openai'});
        return {text, thinking, provider: 'openai'};
      }
    }
  }

  if (buffer.trim()) consumeLine(buffer.trim());
  sendSse(res, 'done', {text, thinking, provider: 'openai'});
  return {text, thinking, provider: 'openai'};
}

app.post('/api/scene/tune-codegen/stream', async (req, res) => {
  const {sceneId, prompt, history = []} = req.body || {};
  console.log(`[api/scene/tune-codegen/stream] scene=${sceneId}`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (!sceneId || !/^scene\d+$/i.test(sceneId)) throw new Error('sceneId is required');
    if (!prompt?.trim()) throw new Error('Prompt is required');
    if (codegenState.running) throw new Error('Scene code generation is already running');

    const {script, scene} = await findScene(sceneId);
    const captions = await captionData(sceneId);
    if (!captions?.durationInFrames || !Array.isArray(captions.cues) || captions.cues.length === 0) {
      throw new Error(`${sceneId} has no usable alignment. Run ASR/time alignment before tuning Remotion code.`);
    }

    const timing = await sceneTimingPrompt(sceneId);
    const assetContext = await sceneAssetsPrompt(sceneId);
    const conversation = Array.isArray(history)
      ? history.slice(-12).map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${item.content ?? ''}`).join('\n')
      : '';
    const currentNotes = scene.tuningNotes ?? '';
    const tuningBlock = [
      currentNotes,
      '',
      `## LLM 对话微调 ${new Date().toISOString()}`,
      conversation ? `\n### 对话上下文\n${conversation}` : '',
      `\n### 本轮用户要求\n${prompt.trim()}`,
      '',
      '执行要求：结合精确字幕时间轴、现有 designNotes 和上述对话要求，重新生成 Remotion 场景代码；优先修正预览中指出的画面、节奏、字幕和动效问题。',
    ].filter(Boolean).join('\n').trim();

    const nextScript = {
      ...script,
      codegenProvider: 'openai',
      scenes: script.scenes.map((item) => item.id === sceneId ? {...item, tuningNotes: tuningBlock} : item),
    };
    delete nextScript.codegenCliCommand;
    await fs.writeFile(SCRIPT_PATH, JSON.stringify(nextScript, null, 2), 'utf-8');
    sendSse(res, 'status', {message: '已保存本轮微调要求，开始让 LLM 分析修改方案', provider: 'openai'});

    const fallback = [
      '我会按你的要求重新生成 Remotion 代码：',
      `- 场景：${sceneId}`,
      `- 时间轴：${timing.durationSeconds ?? '未知'}s / ${captions.durationInFrames}f`,
      '- 重点：基于当前字幕 cue 和 words 精准调整画面节奏',
      '- 输出：更新生成场景 TSX，并执行 TypeScript 与编辑器构建校验',
    ].join('\n');

    await streamLlmChat(res, {
      fallback,
      system: '你是 Remotion 代码微调 Agent。根据用户对预览效果的反馈，先用简洁中文说明你将如何调整画面、节奏、字幕、动效。不要输出代码。',
      user: [
        `sceneId: ${sceneId}`,
        `用户本轮要求: ${prompt.trim()}`,
        '',
        `现有 tuningNotes:\n${currentNotes || '(empty)'}`,
        '',
        `对话上下文:\n${conversation || '(empty)'}`,
        '',
        `Image assets and visual references:\n${assetContext}`,
        '',
        `精确字幕/词块时间轴:\n${timing.summary}`,
      ].join('\n'),
    });

    Object.assign(codegenState, {
      running: true,
      sceneId,
      provider: 'openai',
      step: 'starting',
      message: `根据对话微调 ${sceneId} Remotion 代码`,
      startTime: Date.now(),
      endTime: null,
      targetFile: null,
      error: null,
      result: null,
      logs: [],
    });
    appendCodegenLog(codegenState.message);
    sendSse(res, 'codegen_status', {status: codegenSnapshot()});

    const result = await runSceneAgent({
      sceneId,
      model: script.llmModel ?? null,
      provider: 'openai',
      repairs: 2,
      check: true,
      onLog: (line) => {
        codegenState.step = 'running';
        codegenState.message = line.replace(/^\[scene-agent\]\s*/, '');
        appendCodegenLog(line);
        sendSse(res, 'codegen_log', {line, status: codegenSnapshot()});
      },
    });

    codegenState.running = false;
    codegenState.step = 'done';
    codegenState.message = `${sceneId} Remotion 代码已根据对话微调`;
    codegenState.endTime = Date.now();
    codegenState.targetFile = result.targetFile ?? null;
    codegenState.result = result;
    appendCodegenLog(codegenState.message);
    await buildManifest().catch((error) => appendCodegenLog(`Manifest rebuild failed: ${error.message || error}`));
    sendSse(res, 'codegen_done', {result, status: codegenSnapshot(), config: nextScript});
  } catch (e) {
    codegenState.running = false;
    codegenState.step = 'failed';
    codegenState.message = `${sceneId ?? 'scene'} Remotion 代码微调失败`;
    codegenState.endTime = Date.now();
    codegenState.error = e.message || String(e);
    appendCodegenLog(`${codegenState.message}: ${codegenState.error}`);
    sendSse(res, 'error', {error: codegenState.error, status: codegenSnapshot()});
  } finally {
    res.end();
  }
});

app.post('/api/scene/design', async (req, res) => {
  const {sceneId, text, durationMs, prompt = '', currentDesignNotes = ''} = req.body || {};
  console.log(`[api/scene/design] scene=${sceneId}`);
  try {
    if (!sceneId || !text?.trim()) throw new Error('sceneId and text are required');
    const timing = await sceneTimingPrompt(sceneId);
    const assetContext = await sceneAssetsPrompt(sceneId);
    const preciseDuration = timing.durationSeconds ?? (durationMs ? Number((durationMs / 1000).toFixed(3)) : null);

    const fallback = [
      `## ${sceneId} 视觉设计方案`,
      '',
      '- **画面基调**：科技感深色背景，辅以粒子动效',
      '- **主体元素**：核心关键词居中放大，配合辅助图标',
      '- **色彩方案**：主色 #00e5ff，辅色 #ff79c6，背景 #0b1020',
      '- **动画节奏**：按实际 cue 和词块时间轴切分，不按整数秒粗切',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长适配**：${preciseDuration ? `${preciseDuration}s` : '未知'}，以实际音频/字幕时间轴为准`,
      prompt?.trim() ? `- **用户要求**：${prompt.trim()}` : '',
    ].join('\n');

    const apiKey = await getLlmApiKey();
    if (!apiKey) {
      return res.json({success: true, design: fallback, provider: 'fallback'});
    }

    const design = await llmChat(
      '你是 Remotion 视频视觉设计师。根据一段短视频文案、精确音频时长和 cue/词块时间轴，给出具体的单场景视觉设计方案。不要把时长四舍五入到整数秒；必须使用 x.x 或 x.xxx 秒和帧数来描述节奏。方案必须包含：画面基调、主体元素、色彩方案、动画节奏（百分比 + 精确秒/帧）、字幕位置、时长适配建议。请用 Markdown 输出，语言简洁专业。',
      `sceneId: ${sceneId}\n文案: ${text}\n用户设计要求: ${prompt || '(empty)'}\n当前设计方案: ${currentDesignNotes || '(empty)'}\n精确时长: ${preciseDuration ? `${preciseDuration}秒` : '未知'}\n\nImage assets and visual references:\n${assetContext}\n\n对齐后的字幕/词块时间轴:\n${timing.summary}`,
    );
    res.json({success: true, design: design || fallback, provider: 'openai'});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/scene/design/stream', async (req, res) => {
  const {sceneId, text, durationMs, prompt = '', currentDesignNotes = ''} = req.body || {};
  console.log(`[api/scene/design/stream] scene=${sceneId}`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (!sceneId || !text?.trim()) throw new Error('sceneId and text are required');
    const timing = await sceneTimingPrompt(sceneId);
    const assetContext = await sceneAssetsPrompt(sceneId);
    const preciseDuration = timing.durationSeconds ?? (durationMs ? Number((durationMs / 1000).toFixed(3)) : null);

    const fallback = [
      `## ${sceneId} 视觉设计方案`,
      '',
      '- **画面基调**：科技感深色背景，辅以粒子动效',
      '- **主体元素**：核心关键词居中放大，配合辅助图标',
      '- **色彩方案**：主色 #00e5ff，辅色 #ff79c6，背景 #0b1020',
      '- **动画节奏**：按实际 cue 和词块时间轴切分，不按整数秒粗切',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长适配**：${preciseDuration ? `${preciseDuration}s` : '未知'}，以实际音频/字幕时间轴为准`,
      prompt?.trim() ? `- **用户要求**：${prompt.trim()}` : '',
    ].join('\n');

    await streamLlmChat(res, {
      fallback,
      system: '你是 Remotion 视频视觉设计师。根据用户设计要求、图片角色、短视频文案、精确音频时长和 cue/词块时间轴，给出具体的单场景视觉设计方案。不要把时长四舍五入到整数秒；必须使用 x.x 或 x.xxx 秒和帧数来描述节奏。方案必须明确说明哪些图片只作 reference，哪些图片作为 render 素材进入画面。方案必须包含：画面基调、主体元素、图片使用策略、色彩方案、动画节奏（百分比 + 精确秒/帧）、字幕位置、时长适配建议。请用 Markdown 输出，语言简洁专业。',
      user: `sceneId: ${sceneId}\n文案: ${text}\n用户设计要求: ${prompt || '(empty)'}\n当前设计方案: ${currentDesignNotes || '(empty)'}\n精确时长: ${preciseDuration ? `${preciseDuration}秒` : '未知'}\n\nImage assets and visual references:\n${assetContext}\n\n对齐后的字幕/词块时间轴:\n${timing.summary}`,
    });
  } catch (e) {
    sendSse(res, 'error', {error: e.message});
  } finally {
    res.end();
  }
});

app.get('/api/scene/codegen/status', (req, res) => {
  res.json(codegenSnapshot());
});

app.post('/api/scene/codegen', async (req, res) => {
  const {sceneId, model = null, repairs = 2, check = true} = req.body || {};
  console.log(`[api/scene/codegen] scene=${sceneId}`);
  if (codegenState.running) {
    return res.status(409).json({error: 'Scene code generation is already running', status: codegenSnapshot()});
  }

  try {
    if (!sceneId || !/^scene\d+$/i.test(sceneId)) throw new Error('sceneId is required');
    const {script} = await findScene(sceneId);
    const captions = await captionData(sceneId);
    if (!captions?.durationInFrames || !Array.isArray(captions.cues) || captions.cues.length === 0) {
      throw new Error(`${sceneId} has no usable alignment. Run ASR/time alignment before generating Remotion code.`);
    }

    const repairAttempts = Math.max(0, Math.min(3, Number.isInteger(Number(repairs)) ? Number(repairs) : 1));
    Object.assign(codegenState, {
      running: true,
      sceneId,
      provider: 'openai',
      step: 'starting',
      message: `准备生成 ${sceneId} Remotion 代码`,
      startTime: Date.now(),
      endTime: null,
      targetFile: null,
      error: null,
      result: null,
      logs: [],
    });
    appendCodegenLog(codegenState.message);

    runSceneAgent({
      sceneId,
      model,
      provider: 'openai',
      repairs: repairAttempts,
      check: check !== false,
      onLog: (line) => {
        codegenState.step = 'running';
        codegenState.message = line.replace(/^\[scene-agent\]\s*/, '');
        appendCodegenLog(line);
      },
    }).then(async (result) => {
      codegenState.running = false;
      codegenState.step = 'done';
      codegenState.message = `${sceneId} Remotion 代码已生成`;
      codegenState.endTime = Date.now();
      codegenState.targetFile = result.targetFile ?? null;
      codegenState.result = result;
      appendCodegenLog(codegenState.message);
      await buildManifest().catch((error) => appendCodegenLog(`Manifest rebuild failed: ${error.message || error}`));
    }).catch((error) => {
      codegenState.running = false;
      codegenState.step = 'failed';
      codegenState.message = `${sceneId} Remotion 代码生成失败`;
      codegenState.endTime = Date.now();
      codegenState.error = error.message || String(error);
      appendCodegenLog(`${codegenState.message}: ${codegenState.error}`);
    });

    res.json({success: true, status: codegenSnapshot()});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.get('/api/tts/status', (req, res) => {
  res.json({...ttsState, logs: [...ttsState.logs]});
});

app.post('/api/tts', async (req, res) => {
  const {sceneId, force = false} = req.body || {};
  console.log(`[api/tts] scene=${sceneId} force=${force}`);
  if (ttsState.running) {
    return res.status(409).json({error: 'TTS is already running', status: ttsState});
  }
  try {
    const {script, scene} = await findScene(sceneId);
    const existingAudio = await latestSceneAudio(scene.id);
    const outputAudioFile = force && existingAudio ? versionedSceneAudioFile(scene.id) : defaultSceneAudioFile(scene.id);
    const outputAudioPath = path.join(__dirname, outputAudioFile);
    updateTtsState({
      running: true,
      mode: 'scene',
      sceneId: scene.id,
      currentSceneId: scene.id,
      currentIndex: 1,
      total: 1,
      done: 0,
      step: 'preparing',
      message: '准备生成语音',
      taskId: null,
      providerStatus: null,
      outputFile: outputAudioFile,
      startedAt: Date.now(),
      endTime: null,
      error: null,
      logs: [],
    }, `开始生成 ${scene.id}`);

    if (existingAudio && !force) {
      console.log(`[api/tts] skip existing audio: ${existingAudio.relPath}. Use force=true to regenerate.`);
      updateTtsState({
        running: false,
        done: 1,
        step: 'skipped',
        message: '音频已存在，跳过生成',
        endTime: Date.now(),
        outputFile: existingAudio.relPath,
      }, `${scene.id}: 音频已存在，跳过`);
      return res.json({success: true, skipped: true, audioFile: existingAudio.relPath, audioUrl: audioUrl(existingAudio.relPath)});
    }

    await fs.mkdir(path.dirname(outputAudioPath), {recursive: true});
    const result = await synthesizeLipVoice({
      tts: true,
      ttsBaseUrl: script.ttsBaseUrl,
      ttsSign: script.ttsSign,
      ttsAudioId: script.ttsAudioId,
      ttsStyle: script.ttsStyle,
      ttsGenre: script.ttsGenre,
      ttsExt: script.ttsExt,
      ttsSpeed: script.ttsSpeed ?? 1.0,
      ttsOut: outputAudioFile,
      ttsTimeoutMs: 180000,
      ttsPollIntervalMs: 2000,
      ttsRequestTimeoutMs: 30000,
      onProgress: createTtsProgress(scene.id),
    }, scene.text);
    await buildManifest();

    updateTtsState({
      running: false,
      done: 1,
      step: 'done',
      message: '语音生成完成',
      outputFile: result,
      endTime: Date.now(),
    }, `${scene.id}: 语音生成完成`);
    res.json({success: true, skipped: false, audioFile: result, audioUrl: audioUrl(result)});
  } catch (e) {
    updateTtsState({
      running: false,
      step: 'failed',
      message: '语音生成失败',
      error: e.message,
      endTime: Date.now(),
    }, `语音生成失败: ${e.message}`);
    res.status(500).json({error: e.message});
  }
});

app.post('/api/tts/all', async (req, res) => {
  const {force = true} = req.body || {};
  console.log(`[api/tts/all] force=${force}`);
  if (ttsState.running) {
    return res.status(409).json({error: 'TTS is already running', status: ttsState});
  }
  try {
    const script = await readScript();
    const results = [];
    updateTtsState({
      running: true,
      mode: 'all',
      sceneId: null,
      currentSceneId: null,
      currentIndex: 0,
      total: script.scenes.length,
      done: 0,
      step: 'preparing',
      message: '准备批量生成语音',
      taskId: null,
      providerStatus: null,
      outputFile: null,
      startedAt: Date.now(),
      endTime: null,
      error: null,
      logs: [],
    }, `开始批量生成 ${script.scenes.length} 段语音`);
    for (const scene of script.scenes) {
      const existingAudio = await latestSceneAudio(scene.id);
      const outputAudioFile = force && existingAudio ? versionedSceneAudioFile(scene.id) : defaultSceneAudioFile(scene.id);
      const outputAudioPath = path.join(__dirname, outputAudioFile);
      updateTtsState({
        currentSceneId: scene.id,
        currentIndex: results.length + 1,
        step: 'preparing',
        message: `准备生成 ${scene.id}`,
        taskId: null,
        providerStatus: null,
        outputFile: outputAudioFile,
      }, `准备生成 ${scene.id}`);
      if (existingAudio && !force) {
        results.push({sceneId: scene.id, skipped: true, audioFile: existingAudio.relPath});
        updateTtsState({
          done: results.length,
          step: 'skipped',
          message: `${scene.id} 音频已存在，跳过`,
        }, `${scene.id}: 音频已存在，跳过`);
        continue;
      }
      await fs.mkdir(path.dirname(outputAudioPath), {recursive: true});
      const result = await synthesizeLipVoice({
        tts: true,
        ttsBaseUrl: script.ttsBaseUrl,
        ttsSign: script.ttsSign,
        ttsAudioId: script.ttsAudioId,
        ttsStyle: script.ttsStyle,
        ttsGenre: script.ttsGenre,
        ttsExt: script.ttsExt,
        ttsSpeed: script.ttsSpeed ?? 1.0,
        ttsOut: outputAudioFile,
        ttsTimeoutMs: 180000,
        ttsPollIntervalMs: 2000,
        ttsRequestTimeoutMs: 30000,
        onProgress: createTtsProgress(scene.id),
      }, scene.text);
      results.push({sceneId: scene.id, skipped: false, audioFile: result, audioUrl: audioUrl(result)});
      updateTtsState({
        done: results.length,
        step: 'scene-done',
        message: `${scene.id} 语音生成完成`,
        outputFile: result,
      }, `${scene.id}: 语音生成完成`);
    }
    await buildManifest();
    updateTtsState({
      running: false,
      step: 'done',
      message: '全部语音生成完成',
      endTime: Date.now(),
    }, '全部语音生成完成');
    res.json({success: true, results});
  } catch (e) {
    updateTtsState({
      running: false,
      step: 'failed',
      message: '批量语音生成失败',
      error: e.message,
      endTime: Date.now(),
    }, `批量语音生成失败: ${e.message}`);
    res.status(500).json({error: e.message});
  }
});

app.post('/api/asr', async (req, res) => {
  const {sceneId} = req.body || {};
  console.log(`[api/asr] scene=${sceneId} align=always`);
  try {
    const {script, scene} = await findScene(sceneId);
    const audio = await latestSceneAudio(scene.id);
    const audioFile = audio?.relPath ?? defaultSceneAudioFile(scene.id);

    if (!audio) {
      return res.status(400).json({error: `Audio missing for ${scene.id}. Run TTS first.`});
    }

    const [result] = await alignScenes(script, [{...scene, audioFile}], rel('public', 'captions'));
    await buildManifest();
    res.json({success: true, skipped: false, result});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.get('/api/pipeline/status', (req, res) => {
  res.json(snapshot());
});

app.post('/api/pipeline', async (req, res) => {
  const {sceneId} = req.body || {};
  if (globalState.running) {
    return res.status(409).json({error: 'Pipeline is already running', status: snapshot()});
  }

  const jobId = `${Date.now()}`;
  res.json({success: true, jobId, status: snapshot()});
  setImmediate(() => {
    runPipeline(sceneId).then(() => buildManifest()).catch(() => {});
  });
});

app.get('/api/pipeline/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, payload) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify({type, payload})}\n\n`);
  };

  let sentLogCount = 0;
  const unsubscribe = subscribe((status) => {
    send('status', status);
    globalState.logs.slice(sentLogCount).forEach((text) => send('log', {text}));
    sentLogCount = globalState.logs.length;
  });

  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get('/api/render/status', async (req, res) => {
  const videoExists = await outputExists(renderState.outputFile);
  res.json({
    ...renderState,
    videoExists,
    videoUrl: videoExists ? `/${renderState.outputFile}?t=${renderState.endTime ?? Date.now()}` : null,
  });
});

app.post('/api/render', async (req, res) => {
  const {sceneId = null} = req.body || {};
  console.log(`[api/render] start mode=${sceneId ? 'scene' : 'full'} scene=${sceneId ?? '-'}`);
  if (renderState.running) return res.status(409).json({error: 'Render is already running', status: renderState});

  try {
    await buildManifest();
    await fs.mkdir(OUTPUT_DIR, {recursive: true});
  } catch (e) {
    failRender(`准备渲染失败：${e.message}`);
    return res.status(500).json({error: e.message, status: renderState});
  }

  const mode = sceneId ? 'scene' : 'full';
  const outputFile = sceneId ? rel('output', `${sceneId}.preview.mp4`) : rel('output', 'video.mp4');
  const composition = sceneId ? 'PreviewScene' : 'AgentDiscussion';
  const remotionCli = path.join(__dirname, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  const args = [remotionCli, 'render', composition, outputFile];
  let propsFile = null;
  if (sceneId) {
    propsFile = path.join(OUTPUT_DIR, `${sceneId}.props.json`);
    await fs.writeFile(propsFile, JSON.stringify({sceneId}), 'utf-8');
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

  const command = process.execPath;
  let child;
  try {
    child = spawn(command, args, {
      cwd: __dirname,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failRender(`启动渲染进程失败：${error.message}`);
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
    return res.status(500).json({error: error.message, status: renderState});
  }

  const push = (chunk) => {
    chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
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
  child.stdout.on('data', push);
  child.stderr.on('data', push);
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
    if (code !== 0 && !renderState.error) renderState.error = signal ? `Render stopped by signal ${signal}` : `Render exited with code ${code}`;
    if (propsFile) fs.rm(propsFile, {force: true}).catch(() => {});
  });

  res.json({success: true, status: renderState});
});

app.use('/public', express.static(PUBLIC_DIR));
app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(editorDist));
app.use((req, res) => {
  res.sendFile(path.join(editorDist, 'index.html'));
});

const PORT = process.env.EDITOR_PORT || 3456;
app.listen(PORT, () => {
  console.log(`Editor server: http://localhost:${PORT}`);
  console.log('Studio server should be available at http://localhost:3000');
});
