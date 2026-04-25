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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));

const SCRIPT_PATH = path.join(__dirname, 'src/composer/script.json');
const MANIFEST_PATH = path.join(__dirname, 'public/scenes-manifest.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_DIR = path.join(__dirname, 'output');
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
    ...codegenState.logs.slice(-159),
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
    };
  }));
  return {fps: script.fps, scenes};
}

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
    model: process.env.OPENAI_MODEL || script.llmModel || 'gpt-4o-mini',
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

app.post('/api/scene/tune', async (req, res) => {
  const {sceneId, text, prompt, currentNotes = ''} = req.body || {};
  console.log(`[api/scene/tune] scene=${sceneId}`);
  try {
    if (!prompt?.trim()) throw new Error('Prompt is required');

    const fallback = [
      `Scene: ${sceneId}`,
      `目标：${prompt}`,
      '',
      '建议调整：',
      '- 视觉：根据目标强化背景、主体图形和颜色对比。',
      '- 节奏：关键文字提前出现，结尾保留 1 秒缓冲。',
      '- 动画：减少无意义运动，突出本段核心概念。',
      '- 字幕：优先保证可读性，避免和主体元素冲突。',
      currentNotes ? `\n已有备注：${currentNotes}` : '',
    ].filter(Boolean).join('\n');

    const apiKey = await getLlmApiKey();
    if (!apiKey) {
      return res.json({success: true, suggestion: fallback, provider: 'fallback'});
    }

    const suggestion = await llmChat(
      '你是 Remotion 短视频视觉导演。给出可执行、具体、简洁的单场景微调建议，聚焦画面、节奏、字幕和动效。请用 Markdown 列表形式输出，每条建议不超过 40 字。',
      `sceneId: ${sceneId}\n文案: ${text}\n当前备注: ${currentNotes}\n用户要求: ${prompt}`,
    );
    res.json({success: true, suggestion: suggestion || fallback, provider: 'openai'});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/scene/tune/stream', async (req, res) => {
  const {sceneId, text, prompt, currentNotes = ''} = req.body || {};
  console.log(`[api/scene/tune/stream] scene=${sceneId}`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (!prompt?.trim()) throw new Error('Prompt is required');

    const fallback = [
      `Scene: ${sceneId}`,
      `目标：${prompt}`,
      '',
      '建议调整：',
      '- 视觉：围绕目标强化主体、对比和画面层级。',
      '- 节奏：关键文字提前出现，结尾保留 1 秒缓冲。',
      '- 动画：减少无意义运动，突出本段核心概念。',
      '- 字幕：优先保证可读性，避免和主体元素冲突。',
      currentNotes ? `\n已有备注：${currentNotes}` : '',
    ].filter(Boolean).join('\n');

    await streamLlmChat(res, {
      fallback,
      system: '你是 Remotion 短视频视觉导演。给出可执行、具体、简洁的单场景微调建议，聚焦画面、节奏、字幕和动效。请用 Markdown 列表输出，每条建议不超过 40 字。',
      user: `sceneId: ${sceneId}\n文案: ${text}\n当前备注: ${currentNotes}\n用户要求: ${prompt}`,
    });
  } catch (e) {
    sendSse(res, 'error', {error: e.message});
  } finally {
    res.end();
  }
});

app.post('/api/scene/design', async (req, res) => {
  const {sceneId, text, durationMs} = req.body || {};
  console.log(`[api/scene/design] scene=${sceneId}`);
  try {
    if (!sceneId || !text?.trim()) throw new Error('sceneId and text are required');

    const fallback = [
      `## ${sceneId} 视觉设计方案`,
      '',
      '- **画面基调**：科技感深色背景，辅以粒子动效',
      '- **主体元素**：核心关键词居中放大，配合辅助图标',
      '- **色彩方案**：主色 #00e5ff，辅色 #ff79c6，背景 #0b1020',
      '- **动画节奏**：前 20% 入场，中间 60% 展开，后 20% 收尾',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长适配**：约 ${durationMs ? (durationMs / 1000).toFixed(1) + 's' : '未知'}`,
    ].join('\n');

    const apiKey = await getLlmApiKey();
    if (!apiKey) {
      return res.json({success: true, design: fallback, provider: 'fallback'});
    }

    const design = await llmChat(
      '你是 Remotion 视频视觉设计师。根据一段短视频文案和预计时长，给出具体的单场景视觉设计方案。方案必须包含：画面基调、主体元素、色彩方案、动画节奏（按百分比拆分）、字幕位置、时长适配建议。请用 Markdown 输出，语言简洁专业。',
      `sceneId: ${sceneId}\n文案: ${text}\n预计时长: ${durationMs ? (durationMs / 1000).toFixed(1) + '秒' : '未知'}`,
    );
    res.json({success: true, design: design || fallback, provider: 'openai'});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/scene/design/stream', async (req, res) => {
  const {sceneId, text, durationMs} = req.body || {};
  console.log(`[api/scene/design/stream] scene=${sceneId}`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (!sceneId || !text?.trim()) throw new Error('sceneId and text are required');

    const fallback = [
      `## ${sceneId} 视觉设计方案`,
      '',
      '- **画面基调**：科技感深色背景，辅以粒子动效',
      '- **主体元素**：核心关键词居中放大，配合辅助图标',
      '- **色彩方案**：主色 #00e5ff，辅色 #ff79c6，背景 #0b1020',
      '- **动画节奏**：前 20% 入场，中间 60% 展开，后 20% 收尾',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长适配**：约 ${durationMs ? (durationMs / 1000).toFixed(1) + 's' : '未知'}`,
    ].join('\n');

    await streamLlmChat(res, {
      fallback,
      system: '你是 Remotion 视频视觉设计师。根据一段短视频文案和预计时长，给出具体的单场景视觉设计方案。方案必须包含：画面基调、主体元素、色彩方案、动画节奏（按百分比拆分）、字幕位置、时长适配建议。请用 Markdown 输出，语言简洁专业。',
      user: `sceneId: ${sceneId}\n文案: ${text}\n预计时长: ${durationMs ? (durationMs / 1000).toFixed(1) + '秒' : '未知'}`,
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
  const {sceneId, model = null, repairs = 1, check = true} = req.body || {};
  console.log(`[api/scene/codegen] scene=${sceneId}`);
  if (codegenState.running) {
    return res.status(409).json({error: 'Scene code generation is already running', status: codegenSnapshot()});
  }

  try {
    if (!sceneId || !/^scene\d+$/i.test(sceneId)) throw new Error('sceneId is required');
    await findScene(sceneId);
    const captions = await captionData(sceneId);
    if (!captions?.durationInFrames || !Array.isArray(captions.cues) || captions.cues.length === 0) {
      throw new Error(`${sceneId} has no usable alignment. Run ASR/time alignment before generating Remotion code.`);
    }

    const repairAttempts = Math.max(0, Math.min(3, Number.isInteger(Number(repairs)) ? Number(repairs) : 1));
    Object.assign(codegenState, {
      running: true,
      sceneId,
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
