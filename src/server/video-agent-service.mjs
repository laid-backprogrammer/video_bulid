import {spawn} from 'node:child_process';
import path from 'node:path';
import {readJsonFile} from '../composer/json-utils.mjs';
import {MANIFEST_PATH, resolveFromRoot} from './paths.mjs';
import {readScript} from './script-store.mjs';

const MAX_EVENTS = 500;
const DEFAULT_LLM_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_LLM_MODEL = 'kimi-k2.6';

const videoAgentState = {
  running: false,
  status: 'idle',
  runId: null,
  goal: '',
  mode: 'confirm',
  sceneIds: [],
  startTime: null,
  endTime: null,
  exitCode: null,
  error: null,
  events: [],
  logs: [],
};

const listeners = new Set();

const safeSnippet = (text, max = 220) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const notify = (event) => {
  for (const listener of listeners) {
    try {
      listener(event, getVideoAgentStatus());
    } catch {
      // Listener failures should not affect the agent process.
    }
  }
};

const appendEvent = (event) => {
  const normalized = {
    timestamp: Date.now(),
    ...event,
  };
  videoAgentState.events = [...videoAgentState.events.slice(-(MAX_EVENTS - 1)), normalized];
  if (normalized.type === 'log' || normalized.message || normalized.output) {
    const line = normalized.message || normalized.output || JSON.stringify(normalized);
    videoAgentState.logs = [...videoAgentState.logs.slice(-199), `[${new Date().toLocaleTimeString()}] ${safeSnippet(line, 500)}`];
  }
  if (normalized.type === 'error') {
    videoAgentState.error = normalized.message || JSON.stringify(normalized);
    videoAgentState.status = 'failed';
  }
  if (normalized.type === 'needs_confirmation') {
    videoAgentState.status = 'waiting_confirmation';
  }
  if (normalized.type === 'done') {
    videoAgentState.status = normalized.status || 'completed';
  }
  notify(normalized);
};

export function getVideoAgentStatus() {
  return {
    ...videoAgentState,
    events: [...videoAgentState.events],
    logs: [...videoAgentState.logs],
  };
}

export function subscribeVideoAgent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizeSceneIds(sceneIds, script) {
  const available = Array.isArray(script?.scenes)
    ? script.scenes.filter((scene) => scene.enabled !== false && scene.text?.trim()).map((scene) => scene.id)
    : [];
  if (Array.isArray(sceneIds) && sceneIds.length > 0) {
    return sceneIds.map(String).filter((id) => /^scene\d+$/i.test(id));
  }
  return available;
}

function llmSettingsFromScript(script) {
  return {
    baseUrl: process.env.VIDEO_AGENT_BASE_URL || process.env.MOONSHOT_BASE_URL || process.env.OPENAI_BASE_URL || script.llmBaseUrl || DEFAULT_LLM_BASE_URL,
    apiKey: process.env.VIDEO_AGENT_API_KEY || process.env.MOONSHOT_API_KEY || process.env.OPENAI_API_KEY || script.llmApiKey || '',
    model: process.env.VIDEO_AGENT_MODEL || process.env.MOONSHOT_MODEL || process.env.OPENAI_MODEL || script.llmModel || DEFAULT_LLM_MODEL,
  };
}

function buildStateSummary(script, manifest, sceneIds) {
  const wanted = new Set(sceneIds);
  return {
    fps: script.fps,
    scenes: (script.scenes ?? [])
      .filter((scene) => wanted.has(scene.id))
      .map((scene) => ({
        id: scene.id,
        enabled: scene.enabled !== false,
        text: scene.text,
        designNotes: scene.designNotes || '',
        tuningNotes: scene.tuningNotes || '',
        assetCount: Array.isArray(scene.assets) ? scene.assets.length : 0,
      })),
    manifestScenes: (manifest?.scenes ?? [])
      .filter((scene) => wanted.has(scene.id))
      .map((scene) => ({
        id: scene.id,
        durationInFrames: scene.durationInFrames,
        cueCount: Array.isArray(scene.cues) ? scene.cues.length : 0,
        audioFile: scene.audioFile || '',
        captionsFile: scene.captionsFile || '',
      })),
  };
}

export async function startVideoAgentRun({goal, mode = 'confirm', sceneIds = [], options = {}} = {}) {
  if (videoAgentState.running) {
    const error = new Error('Video agent is already running');
    error.status = 409;
    error.state = getVideoAgentStatus();
    throw error;
  }

  const script = await readScript();
  const manifest = await readJsonFile(MANIFEST_PATH).catch(() => null);
  const normalizedSceneIds = normalizeSceneIds(sceneIds, script);
  if (normalizedSceneIds.length === 0) {
    const error = new Error('No scenes available for video agent');
    error.status = 400;
    throw error;
  }

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  Object.assign(videoAgentState, {
    running: true,
    status: 'starting',
    runId,
    goal: String(goal || '生成当前视频').trim(),
    mode: mode === 'auto' ? 'auto' : 'confirm',
    sceneIds: normalizedSceneIds,
    startTime: Date.now(),
    endTime: null,
    exitCode: null,
    error: null,
    events: [],
    logs: [],
  });

  const request = {
    runId,
    goal: videoAgentState.goal,
    mode: videoAgentState.mode,
    sceneIds: normalizedSceneIds,
    options: {
      maxWorkers: 4,
      renderPreview: false,
      renderFull: false,
      ...options,
    },
    llm: llmSettingsFromScript(script),
    state: buildStateSummary(script, manifest, normalizedSceneIds),
  };

  appendEvent({
    type: 'plan',
    runId,
    message: 'Video agent process starting',
    mode: request.mode,
    sceneIds: normalizedSceneIds,
  });

  const python = process.env.PYTHON || 'python';
  const agentPath = resolveFromRoot('agents', 'video_agent', 'video_agent.py');
  const child = spawn(python, [agentPath], {
    cwd: resolveFromRoot(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        appendEvent(JSON.parse(line));
      } catch {
        appendEvent({type: 'log', runId, message: line});
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      appendEvent({type: 'log', runId, message: `[stderr] ${line}`});
    });
  });

  child.on('error', (error) => {
    videoAgentState.running = false;
    videoAgentState.status = 'failed';
    videoAgentState.endTime = Date.now();
    videoAgentState.error = error.message;
    appendEvent({type: 'error', runId, message: error.message});
  });

  child.on('close', (code) => {
    if (stdoutBuffer.trim()) {
      try {
        appendEvent(JSON.parse(stdoutBuffer.trim()));
      } catch {
        appendEvent({type: 'log', runId, message: stdoutBuffer.trim()});
      }
    }
    videoAgentState.running = false;
    videoAgentState.exitCode = code;
    videoAgentState.endTime = Date.now();
    if (code !== 0 && videoAgentState.status !== 'validation_failed' && videoAgentState.status !== 'waiting_confirmation') {
      videoAgentState.status = 'failed';
      if (!videoAgentState.error) videoAgentState.error = `Video agent exited with code ${code}`;
    } else if (videoAgentState.status === 'starting' || videoAgentState.status === 'idle') {
      videoAgentState.status = 'completed';
    }
    notify({type: 'process_exit', runId, code});
  });

  child.stdin.write(JSON.stringify(request));
  child.stdin.end();

  videoAgentState.status = 'running';
  return getVideoAgentStatus();
}
