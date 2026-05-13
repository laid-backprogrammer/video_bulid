#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {runPipeline, globalState, subscribe, snapshot} from './src/composer/runner.mjs';
import {parseJsonText, readJsonFile} from './src/composer/json-utils.mjs';
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
import {getVideoAgentStatus, startVideoAgentRun, subscribeVideoAgent} from './src/server/video-agent-service.mjs';

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
  commandCount: 0,
  fileChanges: [],
};

const codegenCommandPattern = /\bRunning\b|\$ |npx |npm |remotion|tsc|editor:build/i;

const generatedSceneFile = (sceneId) => {
  const match = String(sceneId ?? '').match(/^scene(\d+)$/i);
  return match ? `src/scenes/generated/Scene${match[1]}.generated.tsx` : null;
};

const gitFileChanges = (files = []) => new Promise((resolve) => {
  const normalized = [...new Set(files.filter(Boolean).map((file) => String(file).replace(/\\/g, '/')))];
  if (!normalized.length) {
    resolve([]);
    return;
  }
  execFile('git', ['diff', '--numstat', '--', ...normalized], {cwd: resolveFromRoot()}, (error, stdout) => {
    if (error) {
      resolve(normalized.map((file) => ({file, additions: 0, deletions: 0})));
      return;
    }
    const byFile = new Map(normalized.map((file) => [file, {file, additions: 0, deletions: 0}]));
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      const [added, removed, ...rest] = line.split(/\t/);
      const file = rest.join('\t').replace(/\\/g, '/');
      if (!file) continue;
      byFile.set(file, {
        file,
        additions: Number.isFinite(Number(added)) ? Number(added) : 0,
        deletions: Number.isFinite(Number(removed)) ? Number(removed) : 0,
      });
    }
    resolve([...byFile.values()]);
  });
});

const refreshCodegenChanges = async () => {
  const files = [codegenState.targetFile, codegenState.result?.targetFile].filter(Boolean);
  codegenState.fileChanges = await gitFileChanges(files);
};

const appendCodegenLog = (message) => {
  if (codegenCommandPattern.test(String(message ?? ''))) {
    codegenState.commandCount += 1;
  }
  codegenState.logs = [
    ...codegenState.logs.slice(-399),
    `[${new Date().toLocaleTimeString()}] ${message}`,
  ];
};

const codegenSnapshot = () => ({
  ...codegenState,
  logs: [...codegenState.logs],
  result: codegenState.result ? {...codegenState.result} : null,
  fileChanges: [...(codegenState.fileChanges ?? [])],
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

const AGENT_ACTION_TYPES = new Set([
  'save_config',
  'rewrite_scene_pipeline',
  'run_tts_scene',
  'run_asr_scene',
  'generate_design_scene',
  'generate_code_scene',
  'render_preview_scene',
  'rebuild_manifest',
  'render_full_video',
]);

const safeSnippet = (text, max = 180) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function generatedSceneExists(sceneId) {
  const match = String(sceneId ?? '').match(/^scene(\d+)$/i);
  if (!match) return false;
  return exists(resolveFromRoot('src', 'scenes', 'generated', `Scene${match[1]}.generated.tsx`));
}

function makeAgentAction(type, label, description, {sceneId = null, tone = 'neutral', disabledReason = null, payload = null} = {}) {
  if (!AGENT_ACTION_TYPES.has(type)) throw new Error(`Unsupported agent action: ${type}`);
  return {
    id: `${sceneId ?? 'global'}-${type}`,
    type,
    label,
    description,
    sceneId: sceneId ?? undefined,
    tone,
    disabledReason: disabledReason ?? undefined,
    payload: payload ?? undefined,
  };
}

function extractSceneScriptText(userMessage = '', history = []) {
  const findInText = (value = '') => {
    const text = String(value ?? '');
    const patterns = [
      /(?:口播文案|新文案|文案|脚本|台词|修正为|改为|改成|更新为|定为)[\s\S]{0,100}?[「“"]([^」”"\r\n]{3,240})[」”"]/i,
      /(?:口播文案|新文案|文案|脚本|台词|修正为|改为|改成|更新为|定为)[\s\S]{0,100}?>\s*[「“"]?([^」”"\r\n]{3,240})[」”"]?/i,
      /(?:口播文案|新文案|文案|脚本|台词)\s*(?:是|为|定为|改成|改为|：|:)\s*([^\r\n]{3,240})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = match?.[1]?.replace(/^>\s*/, '').trim();
      if (candidate) return candidate.replace(/[。；;，,]*$/, '').trim();
    }
    return '';
  };
  const explicit = findInText(userMessage);
  if (explicit) return explicit;

  const direct = String(userMessage ?? '').match(/(?:口播文案|文案|脚本|台词)\s*(?:是|为|定为|改成|改为|：|:)\s*["“「]?([^"”」\n]{4,240})/);
  if (direct?.[1]) return direct[1].trim();

  const recent = Array.isArray(history) ? [...history].reverse() : [];
  for (const item of recent) {
    const content = String(item?.content ?? '');
    const fromContent = findInText(content);
    if (fromContent) return fromContent;
    const match = content.match(/(?:口播文案|新文案|文案)\s*(?:是|为|定为|：|:)?\s*[>：:\s]*["“「]([^"”」\n]{4,240})["”」]/);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function hasMentionedAssetChange(userMessage = '', history = []) {
  const text = [
    String(userMessage ?? ''),
    ...(Array.isArray(history) ? history.slice(-4).map((item) => String(item?.content ?? '')) : []),
  ].join('\n');
  return /@[^\s，。；;、)）]+/.test(text)
    && /(?:用|使用|入场|并排|左右|图标|素材|图片|视频|展示|放到|安排|排版|layout|icon|image)/i.test(text);
}

function needsRewritePipeline(userMessage = '', history = [], currentText = '') {
  const requestedScript = extractSceneScriptText(userMessage, history);
  if (requestedScript && requestedScript !== String(currentText ?? '').trim()) return true;
  return hasMentionedAssetChange(userMessage, history) || shouldCommitScene(userMessage);
}

function shouldCommitScene(userMessage = '') {
  const text = String(userMessage ?? '').trim();
  if (/[吗?？]|开始执行了没|执行了吗/.test(text)) return false;
  if (/(?:清理|删除|丢掉|清空).{0,12}(?:预览|preview|旧内容|之前|原来)/i.test(text)) return true;
  if (/(?:全部|全流程|从头|完整).{0,12}(?:重做|重制|重来|重跑|重新生成|重新预览)/i.test(text)) return true;
  if (/(?:重做|重制|重来|重跑|重新生成|重新渲染|重新预览).{0,12}(?:全部|全流程|预览|本段|当前段)/i.test(text)) return true;
  return /^(可以|确认|开始|开始执行|执行|就这样|按这个|没问题|ok|OK)$/i.test(text)
    || /(?:开始执行|确认执行|重新走|重制|重做|按这个.*生成|按这个.*预览)/.test(text);
}

function agentActionPayloadSchema(type) {
  if (type === 'rewrite_scene_pipeline') {
    return {
      type: 'object',
      properties: {
        scriptText: {type: 'string', description: 'Full narration text to write. Omit to reuse the current scene text.'},
        prompt: {type: 'string', description: 'User intent for the visual brief/codegen. Include @asset aliases exactly when the user wants uploaded media used.'},
        force: {type: 'boolean', description: 'Force TTS/ASR/codegen/preview regeneration.'},
        clearPreview: {type: 'boolean', description: 'Clear the existing scene preview before regenerating.'},
      },
    };
  }
  return {type: 'object', properties: {}};
}

function buildAgentToolSchema(actions) {
  return {
    responseSchema: {
      type: 'object',
      required: ['message', 'actions'],
      properties: {
        message: {type: 'string', description: 'Short Chinese reply to the user.'},
        actions: {
          type: 'array',
          description: 'Server-side tools to execute. Choose only from availableTools.',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {type: 'string', enum: [...AGENT_ACTION_TYPES]},
              sceneId: {type: 'string', description: 'scene id such as scene1 when the tool is scene-scoped.'},
              payload: {type: 'object'},
            },
          },
        },
      },
    },
    availableTools: actions.map((action) => ({
      type: action.type,
      sceneId: action.sceneId ?? null,
      label: action.label,
      description: action.description,
      payloadSchema: agentActionPayloadSchema(action.type),
    })),
  };
}

function normalizePlannedAgentActions(rawActions, fallbackActions, context, request = {}) {
  const source = Array.isArray(rawActions) ? rawActions : [];
  const selected = context.selectedScene;
  const normalized = [];
  const currentText = selected?.text || selected?.textPreview || '';
  const userMessage = request.userMessage || '';
  const requestedScript = extractSceneScriptText(userMessage, request.history);
  const wantsClearPreview = /(?:清理|清空|删除|丢掉).{0,12}(?:预览|preview|旧内容|之前|原来)/i.test(userMessage);
  const shouldRewrite = selected && needsRewritePipeline(userMessage, request.history, currentText);

  for (const raw of source) {
    const type = String(raw?.type || raw?.tool || raw?.action || '');
    if (!AGENT_ACTION_TYPES.has(type)) continue;
    const rawSceneId = raw?.sceneId ? String(raw.sceneId) : selected?.id;
    const base = fallbackActions.find((action) => (
      action.type === type && (!action.sceneId || !rawSceneId || action.sceneId === rawSceneId)
    )) ?? fallbackActions.find((action) => action.type === type);
    if (!base) continue;

    const payload = {
      ...(base.payload && typeof base.payload === 'object' ? base.payload : {}),
      ...(raw.payload && typeof raw.payload === 'object' ? raw.payload : {}),
    };
    if (type === 'rewrite_scene_pipeline') {
      payload.scriptText = String(payload.scriptText || requestedScript || currentText).trim();
      payload.prompt = safeSnippet(payload.prompt || userMessage, 500);
      payload.force = true;
      if (wantsClearPreview) payload.clearPreview = true;
      if (!payload.scriptText) continue;
    }
    normalized.push({...base, payload});
  }

  if (shouldRewrite && !normalized.some((action) => action.type === 'rewrite_scene_pipeline')) {
    const base = fallbackActions.find((action) => action.type === 'rewrite_scene_pipeline');
    if (base) {
      normalized.unshift({
        ...base,
        payload: {
          ...(base.payload && typeof base.payload === 'object' ? base.payload : {}),
          scriptText: String(requestedScript || currentText).trim(),
          prompt: safeSnippet(userMessage, 500),
          force: true,
          clearPreview: wantsClearPreview || undefined,
        },
      });
    }
  }

  return normalized.length > 0 ? normalized : fallbackActions;
}

function parseAgentPlanOutput(rawText, fallbackText, fallbackActions, context, request = {}) {
  try {
    const parsed = extractJsonObject(rawText);
    const message = String(parsed?.message || parsed?.reply || fallbackText).trim() || fallbackText;
    const actions = normalizePlannedAgentActions(parsed?.actions, fallbackActions, context, request);
    return {message, actions, source: 'llm-schema'};
  } catch {
    return {
      message: String(rawText || fallbackText).trim() || fallbackText,
      actions: fallbackActions,
      source: 'fallback-schema',
    };
  }
}

function buildAgentActions(context, mode = 'review', request = {}) {
  if (mode === 'advice') return [];
  const selected = context.selectedScene ?? context.scenes.find((scene) => scene.enabled && scene.textChars > 0) ?? context.scenes[0];
  const actions = [];
  const scriptText = extractSceneScriptText(request.userMessage, request.history);
  const shouldRewrite = selected && needsRewritePipeline(request.userMessage, request.history, selected.text || selected.textPreview || '');
  if (shouldRewrite) {
    actions.push(makeAgentAction(
      'rewrite_scene_pipeline',
      scriptText ? '写入文案并重制本段' : '按当前文案重制本段',
      '结构化执行：写入当前 scene 文案/素材意图，然后依次运行 TTS、ASR、视觉方案、Remotion 代码生成和单段预览渲染。',
      {
        sceneId: selected.id,
        tone: 'primary',
        payload: {
          scriptText: scriptText || selected.text || selected.textPreview || '',
          prompt: safeSnippet(request.userMessage, 500),
          force: true,
          clearPreview: /(?:清理|清空|删除|丢掉).{0,12}(?:预览|preview|旧内容|之前|原来)/i.test(request.userMessage || ''),
        },
      },
    ));
  }
  if (selected?.textChars > 0 && !selected.audioReady) {
    actions.push(makeAgentAction('run_tts_scene', '生成本段语音', '调用现有 TTS，为当前场景生成配音。', {sceneId: selected.id, tone: 'primary'}));
  }
  if (selected?.audioReady && !selected.captionsReady) {
    actions.push(makeAgentAction('run_asr_scene', '对齐字幕时间轴', '调用 ASR/时间轴对齐，生成 cues 和 words。', {sceneId: selected.id, tone: 'primary'}));
  }
  if (selected?.captionsReady && !selected.designReady) {
    actions.push(makeAgentAction('generate_design_scene', '生成视觉方案', '让 LLM 根据文案、时间轴和素材生成可执行画面 brief。', {sceneId: selected.id, tone: 'primary'}));
  }
  if (selected?.captionsReady) {
    actions.push(makeAgentAction('generate_code_scene', '生成 Remotion 代码', '根据设计方案、微调要求和字幕时间轴生成场景 TSX。', {sceneId: selected.id, tone: selected.designReady ? 'primary' : 'neutral'}));
    actions.push(makeAgentAction('render_preview_scene', '渲染本段预览', '导出当前场景 MP4，用于检查画面和节奏。', {sceneId: selected.id, tone: 'primary'}));
  }
  actions.push(makeAgentAction('rebuild_manifest', '重建预览数据', '刷新 manifest，让最新音频、字幕和素材进入预览。', {tone: 'neutral'}));
  if (mode === 'auto' && context.readyEnabledScenes > 0) {
    actions.push(makeAgentAction('render_full_video', '渲染完整视频', '将当前已启用且就绪的场景导出为完整视频。', {
      tone: 'warn',
      disabledReason: context.render?.running ? '渲染任务正在运行' : null,
    }));
  }
  return actions.filter((action) => !action.disabledReason).slice(0, mode === 'auto' ? 3 : 5);
}

async function buildAgentContext(sceneId) {
  const [{fps, scenes}, renderStatus] = await Promise.all([
    getScenesStatus(),
    getRenderStatus(),
  ]);

  const generatedEntries = await Promise.all(scenes.map(async (scene) => [scene.id, await generatedSceneExists(scene.id)]));
  const generatedById = new Map(generatedEntries);
  const sceneSummaries = scenes.map((scene) => ({
    id: scene.id,
    enabled: scene.enabled !== false,
    includedInVideo: Boolean(scene.includedInVideo),
    text: String(scene.text ?? ''),
    textChars: String(scene.text ?? '').trim().length,
    textPreview: safeSnippet(scene.text),
    audioReady: Boolean(scene.audioExists),
    captionsReady: Boolean(scene.captionExists),
    cueCount: Array.isArray(scene.cues) ? scene.cues.length : 0,
    durationMs: scene.durationMs ?? null,
    designReady: Boolean(scene.designNotes?.trim()),
    tuningReady: Boolean(scene.tuningNotes?.trim()),
    assetCount: Array.isArray(scene.assets) ? scene.assets.length : 0,
    assets: (scene.assets ?? []).slice(0, 24).map((asset) => ({
      id: safeSnippet(asset.id, 80),
      alias: safeSnippet(asset.alias, 80),
      name: safeSnippet(asset.name, 120),
      assetType: safeSnippet(asset.assetType, 24),
      role: safeSnippet(asset.role, 24),
      notes: safeSnippet(asset.notes, 180),
    })),
    generatedReady: Boolean(generatedById.get(scene.id)),
    previewReady: Boolean(renderStatus.previewVideos?.[scene.id]),
  }));
  const selectedScene = sceneSummaries.find((scene) => scene.id === sceneId) ?? sceneSummaries.find((scene) => scene.enabled) ?? sceneSummaries[0] ?? null;
  const readyEnabledScenes = sceneSummaries.filter((scene) => scene.enabled && scene.textChars > 0 && scene.audioReady && scene.captionsReady).length;

  return {
    fps,
    selectedSceneId: selectedScene?.id ?? null,
    selectedScene,
    readyEnabledScenes,
    enabledScenes: sceneSummaries.filter((scene) => scene.enabled && scene.textChars > 0).length,
    scenes: sceneSummaries,
    render: {
      running: Boolean(renderStatus.running),
      mode: renderStatus.mode,
      sceneId: renderStatus.sceneId,
      videoExists: Boolean(renderStatus.videoExists),
      previewSceneIds: Object.keys(renderStatus.previewVideos ?? {}),
      error: renderStatus.error ? safeSnippet(renderStatus.error, 240) : null,
      progress: renderStatus.progress,
    },
    tts: {
      running: Boolean(ttsState.running),
      currentSceneId: ttsState.currentSceneId,
      message: safeSnippet(ttsState.message, 120),
      error: ttsState.error ? safeSnippet(ttsState.error, 180) : null,
    },
    codegen: {
      running: Boolean(codegenState.running),
      sceneId: codegenState.sceneId,
      message: safeSnippet(codegenState.message, 120),
      error: codegenState.error ? safeSnippet(codegenState.error, 180) : null,
    },
  };
}

function normalizeAgentMode(mode) {
  return ['review', 'auto', 'advice'].includes(mode) ? mode : 'review';
}

function agentModeText(mode) {
  if (mode === 'auto') return '自动模式：暂不作为当前主流程；如果收到该模式，只给自动路径建议，不主动越过安全确认。';
  if (mode === 'advice') return '建议模式：我只分析方案和制作计划，不写入配置，也不调用 TTS、ASR、代码生成或渲染。';
  return '分段协作模式：我只围绕当前 scene 结对讨论；素材按 scene 隔离，用户可用 @alias 指定；本段敲定后进入后台生成，用户继续推进下一段。';
}

function summarizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  return attachments.slice(0, 24).map((item) => ({
    sceneId: safeSnippet(item?.sceneId, 40),
    fileName: safeSnippet(item?.fileName || item?.name, 120),
    alias: safeSnippet(item?.alias, 80),
    mimeType: safeSnippet(item?.mimeType, 80),
    kind: safeSnippet(item?.kind, 30),
    inferredIntent: safeSnippet(item?.inferredIntent, 40),
    notes: safeSnippet(item?.notes, 220),
  }));
}

function summarizeAvailableAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return [];
  return assets.slice(0, 24).map((item) => ({
    id: safeSnippet(item?.id, 80),
    alias: safeSnippet(item?.alias, 80),
    name: safeSnippet(item?.name, 120),
    assetType: safeSnippet(item?.assetType, 24),
    role: safeSnippet(item?.role, 24),
    notes: safeSnippet(item?.notes, 180),
  }));
}

function agentFallbackText(context, userMessage, actions, mode = 'review', attachments = [], availableAssets = []) {
  const selected = context.selectedScene;
  const actionLines = actions.length
    ? actions.map((action, index) => `${index + 1}. ${action.label}${action.sceneId ? `（${action.sceneId}）` : ''}：${action.description}`).join('\n')
    : mode === 'advice' ? '当前处于建议模式，我不会执行制作动作。' : '当前没有可安全执行的动作，先检查文案、语音、字幕和渲染状态。';
  const attachmentLines = attachments.length
    ? attachments.map((item, index) => `${index + 1}. @${item.alias || item.fileName}（${item.sceneId || selected?.id || 'scene'}）${item.fileName}：${item.inferredIntent || item.kind}${item.notes ? `，${item.notes}` : ''}`).join('\n')
    : '本轮没有新增附件。';
  const availableAssetLines = availableAssets.length
    ? availableAssets.map((item, index) => `${index + 1}. @${item.alias || item.id}：${item.assetType || 'asset'} / ${item.role || 'render'}${item.notes ? `，${item.notes}` : ''}`).join('\n')
    : '当前段没有已入库素材。';
  return [
    `我已检查当前项目，目标是“完成当前视频”。`,
    agentModeText(mode),
    '',
    `当前重点场景：${selected?.id ?? '未选择'}。启用且就绪的场景为 ${context.readyEnabledScenes}/${context.enabledScenes || 0} 段。`,
    selected ? `该场景状态：文案 ${selected.textChars ? '有' : '缺'}，语音 ${selected.audioReady ? '有' : '缺'}，字幕 ${selected.captionsReady ? '有' : '缺'}，设计 ${selected.designReady ? '有' : '缺'}，单段预览 ${selected.previewReady ? '已有' : '未导出'}。` : '',
    '',
    '本轮素材判断：',
    attachmentLines,
    '',
    '当前段已入库素材：',
    availableAssetLines,
    '',
    `你的请求：${safeSnippet(userMessage, 240) || '检查下一步'}`,
    '',
    mode === 'advice' ? '建议方案：' : '建议先执行：',
    actionLines,
    '',
    mode === 'auto'
      ? '如果你保持自动模式，我会按这条路径推进到预览稿，并在失败或不确定时暂停。'
      : mode === 'review'
        ? '分段协作下，先围绕当前段对齐意见；用户敲定后该段可后台生成，用户继续推进下一段。'
        : '建议模式下不会自动执行任何制作任务。',
  ].filter(Boolean).join('\n');
}

function compactAgentHistory(history) {
  if (!Array.isArray(history)) return '';
  return history.slice(-8).map((item) => {
    const role = item?.role === 'user' ? 'user' : item?.role === 'agent' ? 'agent' : 'system';
    return `${role}: ${safeSnippet(item?.content, 220)}`;
  }).join('\n');
}

function extractJsonObject(text) {
  const raw = String(text ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate || candidate === raw.slice(0, 0)) throw new Error('LLM 没有返回 JSON');
  return parseJsonText(candidate);
}

function fallbackStoryboard(content, targetSceneCount = 4) {
  const clean = String(content ?? '').replace(/\s+/g, ' ').trim();
  const count = Math.max(1, Math.min(8, Number(targetSceneCount) || 4));
  const segmentSize = Math.max(24, Math.ceil(clean.length / count));
  const scenes = [];
  for (let i = 0; i < count; i++) {
    const text = clean.slice(i * segmentSize, (i + 1) * segmentSize).trim();
    if (!text) continue;
    scenes.push({
      id: `scene${i + 1}`,
      text,
      durationHintSec: Math.max(4, Math.min(12, Math.round(text.length / 18))),
      designNotes: '根据本段文案建立清晰主体画面，字幕避免遮挡核心视觉，节奏以语音时间轴为准。',
    });
  }
  return {
    title: safeSnippet(clean, 28) || '未命名视频',
    summary: '基于用户输入自动拆分的短视频分镜草案，可编辑后应用到项目。',
    scenes: scenes.length ? scenes : [{
      id: 'scene1',
      text: clean || '请补充视频文案。',
      durationHintSec: 6,
      designNotes: '等待用户补充内容后生成视觉方案。',
    }],
  };
}

function normalizeStoryboardDraft(draft, fallback) {
  const source = draft && typeof draft === 'object' ? draft : fallback;
  const scenes = Array.isArray(source.scenes) ? source.scenes : [];
  return {
    title: safeSnippet(source.title || fallback.title || '未命名视频', 80),
    summary: safeSnippet(source.summary || fallback.summary || '', 500),
    scenes: scenes.slice(0, 8).map((scene, index) => ({
      id: /^scene\d+$/i.test(String(scene?.id ?? '')) ? String(scene.id).toLowerCase() : `scene${index + 1}`,
      text: String(scene?.text ?? '').trim().slice(0, 5000),
      designNotes: String(scene?.designNotes ?? '').trim().slice(0, 4000),
      durationHintSec: Math.max(2, Math.min(30, Number(scene?.durationHintSec) || 6)),
    })).filter((scene) => scene.text.trim()),
  };
}

app.post('/api/agent/storyboard', async (req, res) => {
  const {content = '', goal = '生成短视频预览稿', targetSceneCount = 4, attachments = [], mode = 'review'} = req.body || {};
  console.log(`[api/agent/storyboard] mode=${mode} chars=${String(content).length}`);
  try {
    if (!String(content).trim()) throw new Error('content is required');
    const fallback = fallbackStoryboard(content, targetSceneCount);
    let draft = fallback;
    try {
      const text = await llmChat(
        [
          '你是短视频分镜脚本 Agent。',
          '根据用户文章/方向生成可编辑分镜草案，只返回 JSON，不要 Markdown。',
          'JSON shape: {"title": string, "summary": string, "scenes": [{"id":"scene1","text": string,"designNotes": string,"durationHintSec": number}]}',
          '每段 text 是可直接 TTS 的旁白文案，不要写镜头说明进 text。',
          'designNotes 写画面设计、素材使用和节奏要求。',
          '最多 8 段，适合 30-90 秒短视频。',
        ].join('\n'),
        [
          `目标：${safeSnippet(goal, 200)}`,
          `建议场景数：${Math.max(1, Math.min(8, Number(targetSceneCount) || 4))}`,
          `执行模式：${normalizeAgentMode(mode)}`,
          `素材意图：\n${JSON.stringify(summarizeAttachments(attachments), null, 2)}`,
          `用户内容：\n${String(content).slice(0, 12000)}`,
        ].join('\n\n'),
        null,
        {responseFormatJson: true},
      );
      draft = normalizeStoryboardDraft(extractJsonObject(text), fallback);
    } catch (error) {
      draft = normalizeStoryboardDraft(fallback, fallback);
    }
    res.json({success: true, draft});
  } catch (e) {
    res.status(400).json({error: e.message || String(e)});
  }
});

app.post('/api/agent/plan/stream', async (req, res) => {
  const {goal = '完成当前视频', sceneId = '', userMessage = '', history = [], mode: rawMode = 'review', attachments: rawAttachments = [], availableAssets: rawAvailableAssets = []} = req.body || {};
  const mode = normalizeAgentMode(rawMode);
  const attachments = summarizeAttachments(rawAttachments);
  const availableAssets = summarizeAvailableAssets(rawAvailableAssets);
  console.log(`[api/agent/plan/stream] scene=${sceneId || '-'} goal=${safeSnippet(goal, 60)}`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const abortSignal = createResponseAbortSignal(res);

  try {
    const context = await buildAgentContext(sceneId);
    const actions = buildAgentActions(context, mode, {userMessage, history});
    sendSse(res, 'status', {message: '已整理脱敏项目状态，准备生成 Agent 计划', provider: 'server'});
    const toolSchema = buildAgentToolSchema(actions);
    sendSse(res, 'available_actions', {actions, mode, attachments, availableAssets, toolSchema});

    const fallback = agentFallbackText(context, userMessage, actions, mode, attachments, availableAssets);
    let plannedActions = actions;
    const transformAgentPlan = (rawText) => {
      const plan = parseAgentPlanOutput(rawText, fallback, actions, context, {userMessage, history});
      plannedActions = plan.actions;
      return plan.message;
    };
    try {
      await streamLlmChat(res, {
      fallback,
      system: [
        '你是一个本地视频制作工作台里的 LLM Agent，负责帮助用户完成当前 Remotion 视频。',
        '界面是极简对话器，不是控制台；你的回复要像制作搭档，简洁说明你理解了什么、下一步会怎么做。',
        '当前第一阶段主流程是 review=分段协作；auto 自动到完整预览稿暂不作为主流程；advice=只建议不执行。',
        'advice 模式下不得暗示会写入配置、调用 TTS、ASR、代码生成或渲染。',
        'review 模式下，只围绕当前 scene 讨论；每个 scene 的素材互相隔离，不能把其他 scene 的素材混入当前方案。',
        '用户用 @alias 或 @asset_id 精确指定素材；未 @ 的素材只可讨论用途，不要假设会进入 Remotion 生成上下文。',
        '本段敲定后由前端触发后台 TTS、ASR、视觉方案、Remotion 代码生成和单段渲染；用户可以继续推进下一段。',
        '不要输出代码，不要要求用户去命令行操作。',
        '素材意图需要明确：图片可能是画面素材或风格参考；视频可能是插入片段、背景片段或参考；BGM 是全片背景音乐；音效是事件触发或氛围音。',
        '如果素材用途不明确，只追问不确定的素材。',
      ].join('\n'),
      user: [
        `目标：${safeSnippet(goal, 120) || '完成当前视频'}`,
        `执行模式：${mode}；${agentModeText(mode)}`,
        `用户本轮请求：${safeSnippet(userMessage, 500) || '检查当前状态并给下一步计划'}`,
        '',
        'IMPORTANT: Output only JSON matching Tool/action schema. Choose actions only from availableTools.',
        'If the user changes narration text, says the text/script is fixed, or asks to use @mentioned assets in the scene, choose rewrite_scene_pipeline with full scriptText and prompt. Do not claim the script was changed unless rewrite_scene_pipeline is selected.',
        'Use generate_code_scene only when script/audio/timing/design notes are already correct and no new @asset instruction needs to be persisted.',
        'For clear previous preview / redo everything / regenerate current scene, choose rewrite_scene_pipeline.',
        '',
        `Tool/action schema:\n${JSON.stringify(toolSchema, null, 2)}`,
        '',
        `本轮附件/素材意图：\n${JSON.stringify(attachments, null, 2)}`,
        '',
        `当前段已入库素材：\n${JSON.stringify(availableAssets, null, 2)}`,
        '',
        `最近对话：\n${compactAgentHistory(history) || '(empty)'}`,
        '',
        `脱敏项目状态 JSON：\n${JSON.stringify(context, null, 2)}`,
        '',
        `可渲染动作白名单 JSON：\n${JSON.stringify(actions, null, 2)}`,
      ].join('\n'),
        transformText: transformAgentPlan,
        beforeDone: () => {
          sendSse(res, 'actions', {actions: plannedActions, mode, attachments, availableAssets, source: 'llm-schema'});
        },
        responseFormatJson: true,
        signal: abortSignal,
      });
    } catch (error) {
      if (abortSignal.aborted || isAbortError(error)) return;
      const message = error.message || String(error);
      sendSse(res, 'status', {message: `LLM plan stream failed, using validated local tool plan: ${safeSnippet(message, 180)}`, provider: 'fallback'});
      plannedActions = normalizePlannedAgentActions(actions, actions, context, {userMessage, history});
      sendSse(res, 'actions', {actions: plannedActions, mode, attachments, availableAssets, source: 'fallback-schema'});
      sendSse(res, 'token', {delta: fallback, text: fallback, provider: 'fallback'});
      sendSse(res, 'done', {text: fallback, thinking: '', provider: 'fallback'});
    }
  } catch (e) {
    if (abortSignal.aborted || isAbortError(e)) return;
    sendSse(res, 'error', {error: e.message || String(e)});
  } finally {
    res.end();
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

async function llmChat(system, user, model, options = {}) {
  const settings = await getLlmSettings();
  if (!settings.apiKey) throw new Error('未配置 LLM API Key（script.llmApiKey、script.transcribeApiKey 或环境变量 OPENAI_API_KEY）');

  const selectedModel = model || settings.model;
  const requestBody = buildChatRequestBody(selectedModel, [
    {role: 'system', content: system},
    {role: 'user', content: user},
  ], {temperature: 0.7, responseFormatJson: Boolean(options.responseFormatJson)});
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    throw new Error(data?.error?.message || text || response.statusText);
  }
  if (requestBody.stream) {
    return (await readChatStreamText(response, {responseFormatJson: Boolean(options.responseFormatJson)})).text;
  }
  const data = await response.json();
  return normalizeLlmContentText(data.choices?.[0]?.message?.content || '', {
    responseFormatJson: Boolean(options.responseFormatJson),
  });
}

function sendSse(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createResponseAbortSignal(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted|abort/i.test(error?.message || '');
}

function normalizeLlmContentText(text, {responseFormatJson = false} = {}) {
  const raw = String(text ?? '');
  if (!responseFormatJson) return raw.replace(/^\s+/, '');

  const trimmed = raw.trim();
  if (!trimmed) return '';

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    return trimmed.slice(firstObject, lastObject + 1);
  }
  return trimmed;
}

async function getLlmSettings() {
  const script = await readScript().catch(() => ({}));
  const apiKey = process.env.MOONSHOT_API_KEY || script.llmApiKey || script.transcribeApiKey || process.env.OPENAI_API_KEY || null;
  let baseUrl = (
    process.env.MOONSHOT_BASE_URL
    || process.env.OPENAI_BASE_URL
    || script.llmBaseUrl
    || script.transcribeBaseUrl
    || 'https://api.openai.com'
  ).replace(/\/$/, '');
  if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);
  return {
    apiKey,
    baseUrl,
    model: process.env.MOONSHOT_MODEL || script.llmModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

function llmTemperature(model, requested = 0.7) {
  return isKimiK26(model) ? 1 : requested;
}

function isKimiK26(model) {
  return /^kimi-k2\.6(?:$|[-_:.])/i.test(String(model || ''));
}

function buildChatRequestBody(selectedModel, messages, {temperature = 0.7, stream = false, maxTokens = null, forceNonStreaming = false, responseFormatJson = false} = {}) {
  const body = {
    model: selectedModel,
    messages,
    temperature: llmTemperature(selectedModel, temperature),
  };
  if (responseFormatJson) {
    body.response_format = {type: 'json_object'};
  }
  if (isKimiK26(selectedModel) && !forceNonStreaming) {
    return {
      ...body,
      temperature: 1,
      max_tokens: maxTokens ?? 32768,
      top_p: 0.95,
      stream: true,
      thinking: {type: 'enabled'},
    };
  }
  if (stream) body.stream = true;
  if (maxTokens) body.max_tokens = maxTokens;
  return body;
}

async function readChatStreamText(response, {responseFormatJson = false} = {}) {
  if (!response.body) throw new Error('LLM response has no stream body');
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let emittedText = '';
  let thinking = '';

  const consumeLine = (line) => {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;
    const data = JSON.parse(payload);
    const choice = data.choices?.[0] ?? {};
    const delta = choice.delta ?? choice.message ?? {};
    thinking += delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? '';
    text += delta.content ?? '';
    return false;
  };

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (consumeLine(line)) return {text: normalizeLlmContentText(text, {responseFormatJson}), thinking};
    }
  }
  if (buffer.trim()) consumeLine(buffer.trim());
  return {text: normalizeLlmContentText(text, {responseFormatJson}), thinking};
}

async function streamFallbackText(res, fallback, provider = 'fallback', transformText = null, beforeDone = null) {
  sendSse(res, 'status', {message: '未配置 LLM API Key，使用本地兜底内容', provider});
  const finalText = transformText ? transformText(fallback) : fallback;
  const chunks = finalText.match(/.{1,18}/gs) ?? [finalText];
  let text = '';
  for (const chunk of chunks) {
    text += chunk;
    sendSse(res, 'token', {delta: chunk, text, provider});
    await sleep(35);
  }
  beforeDone?.({text: finalText, rawText: fallback, thinking: '', provider});
  sendSse(res, 'done', {text, thinking: '', provider});
  return {text, thinking: '', provider};
}

async function streamNonStreamingChat(res, settings, selectedModel, system, user, reasonText = '', transformText = null, beforeDone = null, responseFormatJson = false, signal = null) {
  sendSse(res, 'status', {
    message: reasonText ? '流式响应不可用，切换为普通响应' : '使用普通响应生成 LLM 内容',
    provider: 'openai',
    model: selectedModel,
  });

  let waitSeconds = 0;
  const waitTimer = setInterval(() => {
    waitSeconds += 5;
    sendSse(res, 'status', {
      message: `Kimi is still generating (${waitSeconds}s)`,
      provider: 'openai',
      model: selectedModel,
    });
  }, 5000);

  let response;
  try {
    const requestBody = buildChatRequestBody(selectedModel, [
      {role: 'system', content: system},
      {role: 'user', content: user},
    ], {temperature: 0.7, forceNonStreaming: true, responseFormatJson});
    response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      signal,
      body: JSON.stringify(requestBody),
    });
  } finally {
    clearInterval(waitTimer);
  }

  const payloadText = await response.text();
  let data = null;
  try {
    data = payloadText ? JSON.parse(payloadText) : null;
  } catch {}
  if (!response.ok) {
    const message = data?.error?.message || payloadText || response.statusText;
    throw new Error(`LLM 请求失败（model=${selectedModel}）：${message}`);
  }

  const rawText = data?.choices?.[0]?.message?.content || '';
  const normalizedRawText = normalizeLlmContentText(rawText, {responseFormatJson});
  const fullText = transformText
    ? transformText(normalizedRawText)
    : normalizedRawText;
  const chunks = fullText.match(/.{1,24}/gs) ?? [fullText];
  let text = '';
  for (const chunk of chunks) {
    text += chunk;
    sendSse(res, 'token', {delta: chunk, text, provider: 'openai'});
    await sleep(20);
  }
  beforeDone?.({text: fullText, rawText: normalizedRawText, thinking: '', provider: 'openai'});
  sendSse(res, 'done', {text, thinking: '', provider: 'openai'});
  return {text, thinking: '', provider: 'openai'};
}

async function streamLlmChat(res, {system, user, fallback, model, transformText = null, beforeDone = null, responseFormatJson = false, signal = null}) {
  const settings = await getLlmSettings();
  if (!settings.apiKey) {
    return streamFallbackText(res, fallback, 'fallback', transformText, beforeDone);
  }

  const selectedModel = model || settings.model;
  sendSse(res, 'status', {
    message: '已连接 LLM，等待流式响应',
    provider: 'openai',
    model: selectedModel,
  });

  const requestBody = buildChatRequestBody(selectedModel, [
    {role: 'system', content: system},
    {role: 'user', content: user},
  ], {temperature: 0.7, stream: true, maxTokens: 32768, responseFormatJson});

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    signal,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (/unsupported|not support|stream/i.test(errorText)) {
      return streamNonStreamingChat(res, settings, selectedModel, system, user, errorText, transformText, beforeDone, responseFormatJson, signal);
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
    const choice = data.choices?.[0] ?? {};
    const delta = choice.delta ?? choice.message ?? {};
    const thinkingDelta = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? '';
    const contentDelta = delta.content ?? '';

    if (thinkingDelta) {
      thinking += thinkingDelta;
      sendSse(res, 'thinking', {delta: thinkingDelta, text: thinking});
    }
    if (contentDelta) {
      text += contentDelta;
      if (!transformText) {
        let displayDelta = contentDelta;
        if (!emittedText) {
          displayDelta = displayDelta.replace(/^\s+/, '');
          if (!displayDelta) return false;
        }
        emittedText += displayDelta;
        sendSse(res, 'token', {delta: displayDelta, text: emittedText, provider: 'openai'});
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
        const normalizedText = normalizeLlmContentText(text, {responseFormatJson});
        const finalText = transformText
          ? transformText(normalizedText)
          : normalizeLlmContentText(emittedText || text, {responseFormatJson});
        if (transformText) sendSse(res, 'token', {delta: finalText, text: finalText, provider: 'openai'});
        beforeDone?.({text: finalText, rawText: normalizedText, thinking, provider: 'openai'});
        sendSse(res, 'done', {text: finalText, thinking, provider: 'openai'});
        return {text: finalText, thinking, provider: 'openai'};
      }
    }
  }

  if (buffer.trim()) consumeLine(buffer.trim());
  const normalizedText = normalizeLlmContentText(text, {responseFormatJson});
  const finalText = transformText
    ? transformText(normalizedText)
    : normalizeLlmContentText(emittedText || text, {responseFormatJson});
  if (transformText) sendSse(res, 'token', {delta: finalText, text: finalText, provider: 'openai'});
  beforeDone?.({text: finalText, rawText: normalizedText, thinking, provider: 'openai'});
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
  const abortSignal = createResponseAbortSignal(res);

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
      signal: abortSignal,
    });
    if (abortSignal.aborted) return;

    Object.assign(codegenState, {
      running: true,
      sceneId,
      provider: 'openai',
      step: 'starting',
      message: `根据对话微调 ${sceneId} Remotion 代码`,
      startTime: Date.now(),
      endTime: null,
      targetFile: generatedSceneFile(sceneId),
      error: null,
      result: null,
      logs: [],
      commandCount: 0,
      fileChanges: [],
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
    await refreshCodegenChanges();
    appendCodegenLog(codegenState.message);
    await buildManifest().catch((error) => appendCodegenLog(`Manifest rebuild failed: ${error.message || error}`));
    sendSse(res, 'codegen_done', {result, status: codegenSnapshot(), config: nextScript});
  } catch (e) {
    if (abortSignal.aborted || isAbortError(e)) return;
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
  const abortSignal = createResponseAbortSignal(res);

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
      signal: abortSignal,
    });
  } catch (e) {
    if (abortSignal.aborted || isAbortError(e)) return;
    sendSse(res, 'error', {error: e.message});
  } finally {
    res.end();
  }
});

app.get('/api/scene/codegen/status', (req, res) => {
  res.json(codegenSnapshot());
});

app.get('/api/video-agent/status', (req, res) => {
  res.json(getVideoAgentStatus());
});

app.post('/api/video-agent/run', async (req, res) => {
  try {
    const status = await startVideoAgentRun(req.body || {});
    res.json({success: true, status});
  } catch (e) {
    res.status(e.status ?? 500).json({error: e.message, status: e.state ?? getVideoAgentStatus()});
  }
});

app.get('/api/video-agent/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send('status', getVideoAgentStatus());
  let sentCount = getVideoAgentStatus().events.length;
  const unsubscribe = subscribeVideoAgent((event, status) => {
    send(event?.type || 'event', {event, status});
    sentCount = status.events.length;
  });
  const replay = setInterval(() => {
    const status = getVideoAgentStatus();
    const pending = status.events.slice(sentCount);
    pending.forEach((event) => send(event?.type || 'event', {event, status}));
    sentCount = status.events.length;
    res.write(':heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(replay);
    unsubscribe();
  });
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
      targetFile: generatedSceneFile(sceneId),
      error: null,
      result: null,
      logs: [],
      commandCount: 0,
      fileChanges: [],
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
      await refreshCodegenChanges();
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

app.post('/api/render/preview/clear', async (req, res) => {
  const {sceneId = null} = req.body || {};
  try {
    if (!sceneId || !/^scene\d+$/i.test(sceneId)) throw new Error('sceneId is required');
    const outputFile = path.join('output', `${sceneId}.preview.mp4`);
    await fs.rm(resolveFromRoot(outputFile), {force: true});
    res.json({success: true, outputFile});
  } catch (e) {
    res.status(400).json({error: e.message || String(e)});
  }
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
