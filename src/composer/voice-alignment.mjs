import fs from 'node:fs/promises';
import path from 'node:path';
import {readJsonFile} from './json-utils.mjs';

const secondsToFrame = (seconds, fps) => Math.max(0, Math.round(Number(seconds) * fps));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const tokenizeForTiming = (text) => (
  String(text ?? '')
    .match(/\p{Script=Han}|[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/gu)
    ?? []
).filter(Boolean);

const buildTimedWords = (text, startFrame, endFrame) => {
  const tokens = tokenizeForTiming(text);
  if (tokens.length === 0) return [];

  const safeStart = Math.max(0, startFrame);
  const safeEnd = Math.max(safeStart + tokens.length, endFrame);
  const span = Math.max(tokens.length, safeEnd - safeStart);

  return tokens.map((token, index) => {
    const wordStart = safeStart + Math.floor((index * span) / tokens.length);
    const wordEnd = safeStart + Math.max(index + 1, Math.floor(((index + 1) * span) / tokens.length));
    return {
      text: token,
      startFrame: clamp(wordStart, safeStart, safeEnd - 1),
      endFrame: clamp(Math.max(wordEnd, wordStart + 1), safeStart + 1, safeEnd),
    };
  });
};

const splitScriptClauses = (text) => {
  const clauses = String(text ?? '')
    .split(/[\n。！？；.!?;，,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return clauses.length > 0 ? clauses : [String(text ?? '').trim()].filter(Boolean);
};

const readSyncSafeInteger = (buffer, offset) => {
  return ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f);
};

const getWavDurationSeconds = (buffer) => {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkStart + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    }

    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
};

const bitrateTable = {
  V1L1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  V1L2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  V1L3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  V2L1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  V2L2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  V2L3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const sampleRateTable = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

const getMp3DurationSeconds = (buffer) => {
  let offset = 0;
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    offset = 10 + readSyncSafeInteger(buffer, 6);
  }

  let totalSamples = 0;
  let sampleRate = 0;
  let frames = 0;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const versionBits = (buffer[offset + 1] >> 3) & 0x03;
    const layerBits = (buffer[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
    const padding = (buffer[offset + 2] >> 1) & 0x01;

    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const versionKey = versionBits === 3 ? 'V1' : 'V2';
    const layerKey = layerBits === 3 ? 'L1' : layerBits === 2 ? 'L2' : 'L3';
    const bitrate = bitrateTable[`${versionKey}${layerKey}`][bitrateIndex] * 1000;
    sampleRate = sampleRateTable[versionBits][sampleRateIndex];

    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }

    const samplesPerFrame = layerKey === 'L1' ? 384 : layerKey === 'L2' ? 1152 : versionBits === 3 ? 1152 : 576;
    const frameLength = layerKey === 'L1'
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : layerKey === 'L3' && versionBits !== 3
        ? Math.floor((72 * bitrate) / sampleRate + padding)
        : Math.floor((144 * bitrate) / sampleRate + padding);

    if (frameLength <= 0) {
      offset += 1;
      continue;
    }

    totalSamples += samplesPerFrame;
    frames += 1;
    offset += frameLength;
  }

  return frames > 0 && sampleRate > 0 ? totalSamples / sampleRate : null;
};

export const getAudioDurationSeconds = async (audioFile) => {
  if (!audioFile) return null;

  try {
    const audioPath = path.resolve(process.cwd(), audioFile);
    const buffer = await fs.readFile(audioPath);
    const duration = getWavDurationSeconds(buffer) ?? getMp3DurationSeconds(buffer);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch (error) {
    console.warn(`读取音频时长失败: ${error instanceof Error ? error.message : '未知错误'}`);
    return null;
  }
};

export const getAudioDurationFrames = async (audioFile, fps) => {
  const seconds = await getAudioDurationSeconds(audioFile);
  return seconds ? Math.ceil(seconds * fps) : null;
};

const transcribeAudio = async (options, audioFile, scriptText) => {
  if (!audioFile || !options.transcribeApiKey) return null;

  const audioPath = path.resolve(process.cwd(), audioFile);
  const audioBuffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.set('file', new Blob([audioBuffer]), path.basename(audioPath));
  form.set('model', options.transcribeModel);
  form.set('response_format', 'verbose_json');
  if (scriptText.length > 0) {
    form.set('prompt', scriptText.slice(0, 2000));
  }
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');

  const response = await fetch(`${options.transcribeBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${options.transcribeApiKey}`},
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`转录失败: ${response.status} ${text}`);
  }

  return response.json();
};

export const transcribeAudioWithFallback = async (options, audioFile, scriptText) => {
  try {
    return await transcribeAudio(options, audioFile, scriptText);
  } catch (error) {
    console.warn(`转录不可用，降级为文案估算: ${error instanceof Error ? error.message : '未知错误'}`);
    return null;
  }
};

export const makeTranscriptFromTranscription = (transcription, fallbackScript, fps, durationInFrames = null) => {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  const words = Array.isArray(transcription?.words) ? transcription.words : [];

  if (segments.length > 0) {
    return segments.map((segment, index) => {
      const startFrame = secondsToFrame(segment.start ?? 0, fps);
      const endFrame = Math.max(secondsToFrame(segment.end ?? 0, fps), startFrame + 1);
      const text = String(segment.text ?? '').trim();
      const timedWords = words
        .filter((word) => Number(word.start) < (segment.end ?? 0) && Number(word.end) > (segment.start ?? 0))
        .map((word) => ({
          text: String(word.word ?? word.text ?? '').trim(),
          startFrame: clamp(secondsToFrame(word.start ?? 0, fps), startFrame, endFrame),
          endFrame: clamp(secondsToFrame(word.end ?? word.start ?? 0, fps), startFrame + 1, endFrame),
        }))
        .filter((word) => word.text.length > 0);
      return {
        id: segment.id ? String(segment.id) : `cue-${index + 1}`,
        startFrame,
        endFrame,
        text,
        words: timedWords.length > 0 ? timedWords : buildTimedWords(text, startFrame, endFrame),
        emphasis: [],
      };
    }).filter((cue) => cue.text.length > 0);
  }

  const source = String(transcription?.text ?? fallbackScript ?? '').trim();
  const sentences = splitScriptClauses(source);
  const count = Math.max(1, sentences.length);
  const estimatedFrames = Math.max(1, durationInFrames ?? Math.round(tokenizeForTiming(source).length * fps / 4));
  const weights = sentences.map((sentence) => Math.max(1, tokenizeForTiming(sentence).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  return sentences.map((text, index) => {
    const remaining = estimatedFrames - cursor;
    const span = index === count - 1
      ? remaining
      : Math.max(1, Math.round((estimatedFrames * weights[index]) / totalWeight));
    const startFrame = cursor;
    const endFrame = Math.max(startFrame + 1, index === count - 1 ? estimatedFrames : cursor + span);
    cursor = endFrame;
    return {
      id: `cue-${index + 1}`,
      startFrame,
      endFrame,
      text,
      words: buildTimedWords(text, startFrame, endFrame),
      emphasis: [],
    };
  });
};

export const alignScenes = async (script, scenesWithAudio, outDir = 'public/captions') => {
  const results = [];
  const options = {
    transcribeBaseUrl: script.transcribeBaseUrl,
    transcribeModel: script.transcribeModel,
    transcribeApiKey: script.transcribeApiKey || process.env.OPENAI_API_KEY,
  };

  if (!options.transcribeApiKey) {
    console.warn('警告: 未设置转录 API Key（script.transcribeApiKey 或环境变量 OPENAI_API_KEY），将使用文案估算时间轴。');
  }

  for (const scene of scenesWithAudio) {
    const captionsFile = path.join(outDir, `${scene.id}.json`);
    console.log(`[${scene.id}] ASR 重新对齐时间轴: ${scene.audioFile}`);
    const audioDurationFrames = await getAudioDurationFrames(scene.audioFile, script.fps);
    const transcription = await transcribeAudioWithFallback(options, scene.audioFile, scene.text);
    const cues = makeTranscriptFromTranscription(transcription, scene.text, script.fps, audioDurationFrames);
    const lastCueEnd = cues.length > 0 ? cues[cues.length - 1].endFrame : 0;
    const durationInFrames = audioDurationFrames ?? lastCueEnd ?? script.fps * 4;
    const wordCount = cues.reduce((sum, cue) => sum + (cue.words?.length ?? 0), 0);

    await fs.mkdir(path.dirname(captionsFile), {recursive: true});
    await fs.writeFile(captionsFile, JSON.stringify({
      id: scene.id,
      text: scene.text,
      audioFile: scene.audioFile,
      durationInFrames,
      cues,
      alignedAt: new Date().toISOString(),
      alignmentSource: transcription ? 'asr' : 'estimated',
      wordCount,
      wordTimingSource: transcription?.words?.length ? 'asr' : 'estimated',
    }, null, 2));
    console.log(`[${scene.id}] 已保存对齐时间轴: ${captionsFile}`);

    results.push({
      ...scene,
      captionsFile,
      durationInFrames,
      cues,
    });
  }

  return results;
};
