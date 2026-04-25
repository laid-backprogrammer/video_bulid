import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reportProgress = (options, event) => {
  options.onProgress?.(event);
};

const removeTemporaryFile = async (filePath, options) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await fs.rm(filePath, {force: true});
      return;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 5) {
        const message = `临时文件清理失败，已忽略：${path.basename(filePath)} (${error.message})`;
        console.warn(message);
        reportProgress(options, {stage: 'cleanup-warning', message});
        return;
      }
      await sleep(250 * attempt);
    }
  }
};

const findExistingFile = async (candidates) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
};

const bundledFfmpegCandidates = () => {
  if (process.platform === 'win32') {
    return [
      path.resolve(process.cwd(), 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe'),
    ];
  }
  return [];
};

const runFfmpeg = async (args) => {
  const bundledFfmpeg = await findExistingFile(bundledFfmpegCandidates());
  if (bundledFfmpeg) {
    return execFileAsync(bundledFfmpeg, args);
  }

  const remotionCli = await findExistingFile([
    path.resolve(process.cwd(), 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
  ]);
  if (remotionCli) {
    return execFileAsync(process.execPath, [remotionCli, 'ffmpeg', ...args]);
  }

  return execFileAsync('ffmpeg', args);
};

const assertLipVoiceResponse = (payload, action) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${action}失败：响应不是 JSON 对象`);
  }
  if (payload.code !== 0) {
    throw new Error(`${action}失败：${payload.msg ?? `code=${payload.code}`}`);
  }
  return payload.data ?? {};
};

const requestJson = async (url, options, action) => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${action}失败：HTTP ${response.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${action}失败：响应不是 JSON：${text.slice(0, 300)}`);
  }
};

const createLipVoiceTask = async (options, content) => {
  const baseUrl = options.ttsBaseUrl.replace(/\/$/, '');
  const ext = options.ttsExt ?? {calm: 1};
  const body = {
    content,
    audioId: options.ttsAudioId,
    style: String(options.ttsStyle ?? '2'),
    genre: Number(options.ttsGenre ?? 1),
    speed: Number(options.ttsSpeed ?? 1.0),
    ext,
  };

  console.log(`LipVoice create request: ${baseUrl}/api/third/tts/create ${JSON.stringify({...body, content: `${content.slice(0, 40)}...`})}`);
  reportProgress(options, {stage: 'create', message: '正在创建 TTS 任务'});
  const payload = await requestJson(`${baseUrl}/api/third/tts/create`, {
    method: 'POST',
    timeoutMs: options.ttsRequestTimeoutMs ?? 30000,
    headers: {
      'Content-Type': 'application/json',
      sign: options.ttsSign,
    },
    body: JSON.stringify(body),
  }, '创建 TTS 任务');

  console.log(`LipVoice create response: ${JSON.stringify(payload)}`);
  const data = assertLipVoiceResponse(payload, '创建 TTS 任务');
  reportProgress(options, {
    stage: 'created',
    message: 'TTS 任务已创建',
    taskId: data.taskId ?? null,
    status: data.status ?? null,
  });
  return data;
};

const queryLipVoiceTask = async (options, taskId) => {
  const baseUrl = options.ttsBaseUrl.replace(/\/$/, '');
  const url = new URL(`${baseUrl}/api/third/tts/result`);
  url.searchParams.set('taskId', taskId);

  const payload = await requestJson(url, {
    timeoutMs: options.ttsRequestTimeoutMs ?? 30000,
    headers: {sign: options.ttsSign},
  }, '查询 TTS 任务');

  console.log(`LipVoice result response: ${JSON.stringify(payload)}`);
  const data = assertLipVoiceResponse(payload, '查询 TTS 任务');
  reportProgress(options, {
    stage: 'poll',
    message: `正在查询 TTS 任务，状态 ${data.status ?? 'unknown'}`,
    taskId,
    status: data.status ?? null,
    hasVoiceUrl: Boolean(data.voiceUrl),
  });
  return data;
};

const waitForLipVoiceTask = async (options, taskId) => {
  const startedAt = Date.now();
  const timeout = options.ttsTimeoutMs ?? 180000;
  const interval = options.ttsPollIntervalMs ?? 2000;

  while (Date.now() - startedAt < timeout) {
    const data = await queryLipVoiceTask(options, taskId);
    console.log(`LipVoice task ${taskId}: status=${data.status}, voiceUrl=${data.voiceUrl ? 'yes' : 'no'}`);

    if (data.status === 2 && data.voiceUrl) {
      return data.voiceUrl;
    }
    if (data.status === 3) {
      throw new Error(`TTS 合成失败：taskId=${taskId}`);
    }
    await sleep(interval);
  }

  throw new Error(`TTS 合成超时：taskId=${taskId}`);
};

const downloadLipVoiceAudio = async (options, voiceUrl, outputFile) => {
  const baseUrl = options.ttsBaseUrl.replace(/\/$/, '');
  const downloadUrl = new URL(voiceUrl, baseUrl);
  if (!downloadUrl.searchParams.has('sign')) {
    downloadUrl.searchParams.set('sign', options.ttsSign);
  }

  console.log(`LipVoice download: ${downloadUrl.toString().replace(options.ttsSign, '***')}`);
  reportProgress(options, {stage: 'download', message: 'TTS 任务完成，正在下载音频'});
  const response = await fetch(downloadUrl, {
    headers: {sign: options.ttsSign},
    signal: AbortSignal.timeout(options.ttsRequestTimeoutMs ?? 30000),
  });

  if (!response.ok) {
    throw new Error(`下载 TTS 音频失败：${response.status} ${await response.text()}`);
  }

  const outputPath = path.resolve(process.cwd(), outputFile);
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  const buffer = Buffer.from(await response.arrayBuffer());

  if (downloadUrl.pathname.toLowerCase().endsWith('.wav') && outputPath.toLowerCase().endsWith('.mp3')) {
    const tempWav = `${outputPath}.${process.pid}.${Date.now()}.download.wav`;
    const fallbackOutputFile = outputFile.replace(/\.mp3$/i, '.wav');
    const fallbackOutputPath = outputPath.replace(/\.mp3$/i, '.wav');
    await fs.writeFile(tempWav, buffer);
    try {
      reportProgress(options, {stage: 'convert', message: '正在转换 WAV 为 MP3'});
      await runFfmpeg(['-y', '-i', tempWav, '-codec:a', 'libmp3lame', '-q:a', '2', outputPath]);
      reportProgress(options, {stage: 'saved', message: '音频文件已保存', outputFile});
      return outputFile;
    } catch (error) {
      await fs.writeFile(fallbackOutputPath, buffer);
      const message = `WAV 转 MP3 失败，已保留 WAV 音频：${error.message}`;
      console.warn(message);
      reportProgress(options, {stage: 'convert-warning', message, outputFile: fallbackOutputFile});
      return fallbackOutputFile;
    } finally {
      await removeTemporaryFile(tempWav, options);
    }
  } else {
    await fs.writeFile(outputPath, buffer);
  }
  reportProgress(options, {stage: 'saved', message: '音频文件已保存', outputFile});
  return outputFile;
};

export const synthesizeLipVoice = async (options, scriptText) => {
  if (!options.tts) return options.audio;
  if (options.audio) return options.audio;
  if (!scriptText.trim()) throw new Error('使用 TTS 时必须提供文案。');
  if (!options.ttsSign) throw new Error('使用 TTS 时必须提供 ttsSign。');
  if (!options.ttsAudioId) throw new Error('使用 TTS 时必须提供 ttsAudioId。');

  const content = scriptText.trim();
  if (content.length > 5000) {
    throw new Error(`LipVoice 单次 content 最大 5000 字符，当前 ${content.length} 字符。`);
  }

  console.log('创建 LipVoice TTS 任务...');
  reportProgress(options, {stage: 'start', message: '开始生成语音'});
  const created = await createLipVoiceTask(options, content);
  const taskId = created.taskId;
  if (!taskId) throw new Error('LipVoice 未返回 taskId。');
  reportProgress(options, {stage: 'task', message: `TTS taskId=${taskId}`, taskId, status: created.status ?? null});

  const voiceUrl = created.status === 2 && created.voiceUrl
    ? created.voiceUrl
    : await waitForLipVoiceTask(options, taskId);
  const outputFile = await downloadLipVoiceAudio(options, voiceUrl, options.ttsOut);
  console.log(`已生成 TTS 音频：${path.resolve(process.cwd(), outputFile)}`);
  return outputFile;
};

export const synthesizeScenes = async (script, outDir = 'public/voiceover') => {
  const results = [];
  for (const scene of script.scenes) {
    const outputFile = path.join(outDir, `${scene.id}.mp3`);
    const fileExists = await fs.access(outputFile).then(() => true).catch(() => false);
    if (fileExists) {
      console.log(`[${scene.id}] 音频已存在，跳过：${outputFile}`);
      results.push({...scene, audioFile: outputFile});
      continue;
    }

    console.log(`[${scene.id}] 生成 TTS：${scene.text.slice(0, 40)}...`);
    const audioFile = await synthesizeLipVoice({
      tts: true,
      ttsBaseUrl: script.ttsBaseUrl,
      ttsSign: script.ttsSign,
      ttsAudioId: script.ttsAudioId,
      ttsStyle: script.ttsStyle,
      ttsGenre: script.ttsGenre,
      ttsExt: script.ttsExt,
      ttsSpeed: script.ttsSpeed,
      ttsOut: outputFile,
      ttsTimeoutMs: 180000,
      ttsPollIntervalMs: 2000,
      ttsRequestTimeoutMs: 30000,
    }, scene.text);
    results.push({...scene, audioFile});
  }
  return results;
};
