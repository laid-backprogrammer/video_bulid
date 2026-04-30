#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runPipeline, globalState, subscribe, snapshot} from './src/composer/runner.mjs';
import {readJsonFile} from './src/composer/json-utils.mjs';
import {synthesizeLipVoice} from './src/composer/voice-synthesis.mjs';
import {alignScenes} from './src/composer/voice-alignment.mjs';
import {runSceneAgent} from './src/composer/scene-agent.mjs';
import {
  buildSceneAssetsMarkdown,
  createSceneAssetRecord,
  normalizeAssetRole,
  normalizeSceneAssets,
  sceneAssetsForStorage,
  validateSceneAssetFile,
} from './src/composer/scene-assets.mjs';
import {
  MANIFEST_PATH,
  PUBLIC_DIR,
  OUTPUT_DIR,
  SCENE_ASSET_DIR,
  editorDist,
  rel,
  defaultSceneAudioFile,
  versionedSceneAudioFile,
  audioUrl,
  isSceneIncludedInVideo,
  resolveFromRoot,
} from './src/server/paths.mjs';
import {
  exists,
  latestSceneAudio,
  captionData,
} from './src/server/media-store.mjs';
import {findScene, mergeConfigSceneAssets, readScript, writeScript} from './src/server/script-store.mjs';
import {buildManifest} from './src/server/manifest-service.mjs';
import {parseMultipartBody} from './src/server/multipart-utils.mjs';
import {getRenderStatus, startRender} from './src/server/render-service.mjs';

const app = express();
app.use(cors());
app.use(express.json({limit: '10mb'}));

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getScenesStatus() {
  const script = await readScript();
  const scenes = await Promise.all(script.scenes.map(async (scene) => {
    const audio = await latestSceneAudio(scene.id);
    const captionPath = path.join(PUBLIC_DIR, 'captions', `${scene.id}.json`);
    const audioExists = Boolean(audio);
    const captionExists = await exists(captionPath);
    const cap = captionExists ? await readJsonFile(captionPath).catch(() => null) : null;
    const durationMs = cap?.durationInFrames ? Math.round((cap.durationInFrames / script.fps) * 1000) : null;
    const audioFile = audio?.relPath ?? '';
    const captionsFile = rel('public', 'captions', `${scene.id}.json`);
    return {
      ...scene,
      enabled: scene.enabled !== false,
      includedInVideo: isSceneIncludedInVideo(scene),
      audioExists,
      captionExists,
      durationMs,
      durationInFrames: cap?.durationInFrames ?? null,
      audioFile,
      captionsFile: captionExists ? captionsFile : '',
      cues: cap?.cues ?? [],
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

const compactTimingForDesign = (timing) => {
  if (!timing?.summary) return 'No aligned timing available.';
  const lines = String(timing.summary).split(/\r?\n/);
  const header = lines.filter((line) => /^(fps|duration|alignmentSource|wordTimingSource):/.test(line)).join('\n');
  const cueLines = lines
    .filter((line) => /^cue\s+\d+:/i.test(line))
    .slice(0, 8)
    .join('\n');
  return [
    header,
    cueLines,
    timing.durationSeconds ? `Use this only to choose broad beats; do not copy every word timing into the design. duration=${timing.durationSeconds}s` : '',
  ].filter(Boolean).join('\n');
};

const sceneAssetsPrompt = async (sceneId, mentionText = '') => {
  const {scene} = await findScene(sceneId);
  return buildSceneAssetsMarkdown(scene.assets, {
    mentionText,
    requireMention: true,
  });
};

const ASSET_MENTION_SYSTEM_NOTE = '素材 @ 提及规则：用户必须使用 @alias 或 @asset_id 指定某张素材，模型只能使用本轮上下文中列出的已 @ 提及素材；没有 @ 提及的上传素材不得使用，也不会作为可用素材上下文提供。图片素材必须区分 reference/render/both：reference 只参考不入画，render/both 可入画；视频和音频默认是可插入素材。必须在方案中保留素材 @alias，并按用户描述安排视频位置、音频触发时机、层级、运动路径或背景/主体用途。';

const CONCISE_DESIGN_SYSTEM_PROMPT = [
  '你是 Remotion 单场景视觉 brief 设计师。',
  '输出必须短，只保留会影响代码生成的决策，不写施工手册。',
  '严格限制：最多 6 个小节，最多 18 条 bullet，总字数尽量控制在 500-900 中文字。',
  '不要输出逐词时间轴、完整字幕表、图层顺序清单、CSS 大段代码、staticFile path、Remotion 代码、精确 x/y/width/height 清单，除非用户明确给了这些硬约束。',
  '不要把一句话文案扩写成百科式方案；文案越短，brief 越短。',
  '只给关键内容：1. 有效用户要求 2. 布局/构图 3. 必用/禁用素材 4. 视觉风格 5. 关键节奏 6. 字幕安全区。',
  '动画节奏只写 2-4 个阶段，用 cue/开头/中段/结尾描述；不要列出每个词块。',
  '媒体素材必须按 @alias 或 @asset_id 说明；没有 @ 提及的素材不要纳入方案。',
  ASSET_MENTION_SYSTEM_NOTE,
].join('\n');

const compactStoredNotes = (notes = '', {maxChars = 2400} = {}) => {
  const text = String(notes || '').trim();
  if (text.length <= maxChars) return text;
  const blocks = text.split(/(?=## LLM 对话微调 )/g).map((block) => block.trim()).filter(Boolean);
  const tail = blocks.slice(-3).join('\n\n');
  return (tail.length > maxChars ? tail.slice(-maxChars) : tail).trim();
};

const compactRecentConversation = (history = [], {maxItems = 4, maxChars = 1200} = {}) => {
  if (!Array.isArray(history)) return '';
  const lines = history
    .filter((item) => item?.content)
    .slice(-maxItems)
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${String(item.content ?? '').replace(/\s+/g, ' ').trim()}`);
  return lines.join('\n').slice(0, maxChars).trim();
};

const previousDesignContext = (currentDesignNotes = '', prompt = '') => {
  if (String(prompt || '').trim()) {
    return '本轮已有明确用户要求：旧设计方案仅用于避免遗漏素材/字幕安全区，不作为风格来源；冲突时必须丢弃旧风格。';
  }
  return String(currentDesignNotes || '(empty)').slice(0, 600);
};

const normalizeDesignBrief = (text = '', fallback = '', {maxChars = 1100, maxLines = 24} = {}) => {
  const source = String(text || fallback || '').trim();
  if (!source) return String(fallback || '').trim();

  const withoutNoise = source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*\|/g, '')
    .replace(/^[-*]\s*(?:\d+\.\d+s|[0-9]+f|时间|帧数|词块).*$\n?/gim, '');
  const stopIndex = withoutNoise.search(/^##\s*\d+\.?\s*(?:字幕词块|图层顺序|Remotion|实现提示|时长适配|完整时间轴)/im);
  const body = stopIndex > 0 ? withoutNoise.slice(0, stopIndex) : withoutNoise;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:---+|###?\s*\d+\.\d+|[|:：\-\s\d.f秒s]+)$/.test(line))
    .filter((line) => !/(staticFile path|Remotion 选择建议|渲染方式|最终布局|入场动画|x:|y:|width:|height:|z-index|object-fit)/i.test(line));

  const kept = [];
  for (const line of lines) {
    const normalized = line
      .replace(/^#{1,6}\s*/, '## ')
      .replace(/\s+/g, ' ')
      .slice(0, 160);
    if (!normalized || kept.includes(normalized)) continue;
    kept.push(normalized);
    if (kept.length >= maxLines || kept.join('\n').length >= maxChars) break;
  }

  const compact = kept.join('\n').slice(0, maxChars).trim();
  return compact || source.slice(0, maxChars).trim();
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
    const existingScript = await readScript().catch(() => null);
    const nextScript = mergeConfigSceneAssets(req.body, existingScript);
    await writeScript(nextScript);
    await buildManifest().catch(() => {});
    res.json({success: true, config: nextScript});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

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
    await writeScript(nextScript);
    res.json({success: true, data, config: nextScript});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.post('/api/scene/assets', express.raw({type: 'multipart/form-data', limit: '220mb'}), async (req, res) => {
  try {
    const script = await readScript();
    const {fields, files} = parseMultipartBody(req.body, req.headers['content-type']);
    const sceneId = String(fields.sceneId || '').trim();
    if (!/^scene\d+$/i.test(sceneId)) throw new Error('sceneId must look like scene1, scene2, ...');
    const role = normalizeAssetRole(fields.role);
    const notes = String(fields.notes || '').trim();
    const alias = String(fields.alias || '').trim();
    const file = files.file;
    const sceneIndex = script.scenes.findIndex((item) => item.id === sceneId);
    if (sceneIndex === -1) throw new Error(`Scene not found: ${sceneId}`);
    validateSceneAssetFile(file);

    const {asset, storedName} = createSceneAssetRecord({sceneId, file, role, notes, alias});
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
    await writeScript(nextScript);
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

    const absAssetPath = resolveFromRoot(asset.file);
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
    await writeScript(nextScript);
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
    const script = await readScript();
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
  const script = await readScript().catch(() => ({}));
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

async function streamFallbackText(res, fallback, provider = 'fallback', transformText = null) {
  sendSse(res, 'status', {message: '未配置 LLM API Key，使用本地兜底内容', provider});
  const finalText = transformText ? transformText(fallback) : fallback;
  const chunks = finalText.match(/.{1,18}/gs) ?? [finalText];
  let text = '';
  for (const chunk of chunks) {
    text += chunk;
    sendSse(res, 'token', {delta: chunk, text, provider});
    await sleep(35);
  }
  sendSse(res, 'done', {text, thinking: '', provider});
  return {text, thinking: '', provider};
}

async function streamNonStreamingChat(res, settings, selectedModel, system, user, reasonText = '', transformText = null) {
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

  const fullText = transformText
    ? transformText(data?.choices?.[0]?.message?.content || '')
    : data?.choices?.[0]?.message?.content || '';
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

async function streamLlmChat(res, {system, user, fallback, model, transformText = null}) {
  const settings = await getLlmSettings();
  if (!settings.apiKey) {
    return streamFallbackText(res, fallback, 'fallback', transformText);
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
      return streamNonStreamingChat(res, settings, selectedModel, system, user, errorText, transformText);
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
      if (!transformText) {
        sendSse(res, 'token', {delta: contentDelta, text});
      }
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
        const finalText = transformText ? transformText(text) : text;
        if (transformText) sendSse(res, 'token', {delta: finalText, text: finalText, provider: 'openai'});
        sendSse(res, 'done', {text: finalText, thinking, provider: 'openai'});
        return {text: finalText, thinking, provider: 'openai'};
      }
    }
  }

  if (buffer.trim()) consumeLine(buffer.trim());
  const finalText = transformText ? transformText(text) : text;
  if (transformText) sendSse(res, 'token', {delta: finalText, text: finalText, provider: 'openai'});
  sendSse(res, 'done', {text: finalText, thinking, provider: 'openai'});
  return {text: finalText, thinking, provider: 'openai'};
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
    const assetContext = await sceneAssetsPrompt(sceneId, prompt);
    const conversation = compactRecentConversation(history);
    const tuningBlock = [
      `## 当前微调要求 ${new Date().toISOString()}`,
      '',
      `### 本轮用户要求\n${prompt.trim()}`,
      conversation ? `\n### 最近对话摘要（仅本轮附近）\n${conversation}` : '',
      '',
      '执行要求：本轮用户要求具有最高优先级，覆盖旧 tuningNotes、旧 designNotes 和之前生成代码中的冲突风格/布局/细节。不要累积历史对话，不要沿用旧风格，除非本轮明确要求保留。',
    ].filter(Boolean).join('\n').trim();

    const nextScript = {
      ...script,
      codegenProvider: 'openai',
      scenes: script.scenes.map((item) => item.id === sceneId ? {...item, tuningNotes: tuningBlock} : item),
    };
    delete nextScript.codegenCliCommand;
    await writeScript(nextScript);
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
        '旧 tuningNotes 已被本轮要求替换，不要把旧对话当作风格来源。',
        '',
        `最近对话摘要:\n${conversation || '(empty)'}`,
        '',
        `Media assets and visual references:\n${assetContext}`,
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
    const assetContext = await sceneAssetsPrompt(sceneId, prompt);
    const preciseDuration = timing.durationSeconds ?? (durationMs ? Number((durationMs / 1000).toFixed(3)) : null);

    const fallback = [
      `## ${sceneId} 简洁视觉 brief`,
      '',
      prompt?.trim() ? `- **用户要求**：${prompt.trim()}` : '- **用户要求**：围绕文案做清晰开场视觉',
      '- **布局**：主体信息居中，必要素材按用户指定位置入画',
      '- **素材**：只使用本轮 @ 提及素材；未 @ 提及素材禁用',
      '- **风格**：深色科技感，少量蓝紫光晕，避免堆叠过多装饰',
      '- **节奏**：开头建立主题，中段稳定展示，结尾保持问题定格',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长**：${preciseDuration ? `${preciseDuration}s` : '以实际字幕时间轴为准'}`,
    ].join('\n');

    const apiKey = await getLlmApiKey();
    if (!apiKey) {
      return res.json({success: true, design: fallback, provider: 'fallback'});
    }

    const design = await llmChat(
      CONCISE_DESIGN_SYSTEM_PROMPT,
      `sceneId: ${sceneId}\n文案: ${text}\n用户设计要求: ${prompt || '(empty)'}\n旧设计方案处理规则: ${previousDesignContext(currentDesignNotes, prompt)}\n精确时长: ${preciseDuration ? `${preciseDuration}秒` : '未知'}\n\nMedia assets and visual references:\n${assetContext}\n\n精简时间轴，禁止逐词复述:\n${compactTimingForDesign(timing)}`,
    );
    res.json({success: true, design: normalizeDesignBrief(design, fallback), provider: 'openai'});
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
    const assetContext = await sceneAssetsPrompt(sceneId, prompt);
    const preciseDuration = timing.durationSeconds ?? (durationMs ? Number((durationMs / 1000).toFixed(3)) : null);

    const fallback = [
      `## ${sceneId} 简洁视觉 brief`,
      '',
      prompt?.trim() ? `- **用户要求**：${prompt.trim()}` : '- **用户要求**：围绕文案做清晰开场视觉',
      '- **布局**：主体信息居中，必要素材按用户指定位置入画',
      '- **素材**：只使用本轮 @ 提及素材；未 @ 提及素材禁用',
      '- **风格**：深色科技感，少量蓝紫光晕，避免堆叠过多装饰',
      '- **节奏**：开头建立主题，中段稳定展示，结尾保持问题定格',
      '- **字幕位置**：底部居中，避免遮挡主体',
      `- **时长**：${preciseDuration ? `${preciseDuration}s` : '以实际字幕时间轴为准'}`,
    ].join('\n');

    await streamLlmChat(res, {
      fallback,
      system: CONCISE_DESIGN_SYSTEM_PROMPT,
      user: `sceneId: ${sceneId}\n文案: ${text}\n用户设计要求: ${prompt || '(empty)'}\n旧设计方案处理规则: ${previousDesignContext(currentDesignNotes, prompt)}\n精确时长: ${preciseDuration ? `${preciseDuration}秒` : '未知'}\n\nMedia assets and visual references:\n${assetContext}\n\n精简时间轴，禁止逐词复述:\n${compactTimingForDesign(timing)}`,
      transformText: (text) => normalizeDesignBrief(text, fallback),
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
    const outputAudioPath = resolveFromRoot(outputAudioFile);
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
      total: script.scenes.filter(isSceneIncludedInVideo).length,
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
    }, `开始批量生成 ${script.scenes.filter(isSceneIncludedInVideo).length} 段语音`);
    for (const scene of script.scenes.filter(isSceneIncludedInVideo)) {
      const existingAudio = await latestSceneAudio(scene.id);
      const outputAudioFile = force && existingAudio ? versionedSceneAudioFile(scene.id) : defaultSceneAudioFile(scene.id);
      const outputAudioPath = resolveFromRoot(outputAudioFile);
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
  const {sceneId, forceTts, reuseAudio = false} = req.body || {};
  if (globalState.running) {
    return res.status(409).json({error: 'Pipeline is already running', status: snapshot()});
  }

  const shouldForceTts = forceTts ?? !reuseAudio;
  const jobId = `${Date.now()}`;
  res.json({success: true, jobId, forceTts: shouldForceTts, status: snapshot()});
  setImmediate(() => {
    runPipeline(sceneId, {forceTts: shouldForceTts}).then(() => buildManifest()).catch(() => {});
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
  res.json(await getRenderStatus());
});

app.post('/api/render', async (req, res) => {
  const {sceneId = null} = req.body || {};
  console.log(`[api/render] start mode=${sceneId ? 'scene' : 'full'} scene=${sceneId ?? '-'}`);
  try {
    const status = await startRender({sceneId});
    res.json({success: true, status});
  } catch (e) {
    res.status(e.status ?? 500).json({error: e.message, status: e.state ?? await getRenderStatus()});
  }
});

app.use('/public', express.static(PUBLIC_DIR));
app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(editorDist));
app.use((req, res) => {
  res.sendFile(path.join(editorDist, 'index.html'));
});

const PORT = process.env.EDITOR_PORT || 3456;
const HOST = process.env.EDITOR_HOST || '127.0.0.1';
const STUDIO_PORT = process.env.REMOTION_STUDIO_PORT || process.env.STUDIO_PORT || 3001;
const server = app.listen(PORT, HOST, () => {
  console.log(`Editor server: http://${HOST}:${PORT}`);
  console.log(`Studio server should be available at http://localhost:${STUDIO_PORT}`);
});

server.on('error', (error) => {
  console.error(`Editor server failed to listen on ${HOST}:${PORT}: ${error.message}`);
  process.exit(1);
});

setInterval(() => {}, 60 * 60 * 1000);
