import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

/* ---------- Error Boundary ---------- */
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; error?: Error}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false};
  }
  static getDerivedStateFromError(error: Error) {
    return {hasError: true, error};
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 40, color: '#ff6b6b', fontFamily: 'monospace'}}>
          <h2>页面渲染出错</h2>
          <pre style={{whiteSpace: 'pre-wrap'}}>{this.state.error?.message ?? '未知错误'}</pre>
          <p style={{color: '#9fb3c8'}}>请刷新页面重试，或检查浏览器控制台获取详细错误信息。</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const API_BASE = '';
const STUDIO_URL = 'http://localhost:3000';

type ScriptScene = {
  id: string;
  text: string;
  tuningNotes?: string;
  designNotes?: string;
};

type SceneItem = ScriptScene & {
  audioExists: boolean;
  captionExists: boolean;
  durationMs: number | null;
  audioUrl: string | null;
  captionsUrl: string | null;
};

type Config = {
  fps: number;
  ttsBaseUrl: string;
  ttsSign: string;
  ttsAudioId: string;
  ttsSpeed: number;
  ttsStyle?: string;
  ttsGenre?: number;
  transcribeBaseUrl: string;
  transcribeModel: string;
  transcribeApiKey: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  scenes: ScriptScene[];
};

type PipelineStatus = {
  running: boolean;
  scenes: Array<{id: string; step: string; status: string; error: string | null}>;
};

type RenderProgress = {
  rendered: number;
  total: number | null;
  encoded: number;
  percent: number;
  phase: string;
} | null;

type RenderStatus = {
  running: boolean;
  exitCode: number | null;
  startTime: number | null;
  endTime: number | null;
  outputFile: string;
  mode: 'full' | 'scene';
  sceneId: string | null;
  progress: RenderProgress;
  logs: string[];
  error: string | null;
  videoUrl: string | null;
  videoExists: boolean;
};

type WorkflowStep = 'script' | 'audio' | 'design' | 'preview' | 'render';

type TtsStatus = {
  running: boolean;
  mode: 'scene' | 'all' | null;
  sceneId: string | null;
  currentSceneId: string | null;
  currentIndex: number;
  total: number;
  done: number;
  step: string;
  message: string;
  taskId: string | null;
  providerStatus: string | number | null;
  outputFile: string | null;
  startedAt: number | null;
  endTime: number | null;
  error: string | null;
  logs: string[];
};

type CodegenStatus = {
  running: boolean;
  sceneId: string | null;
  step: string;
  message: string;
  startTime: number | null;
  endTime: number | null;
  targetFile: string | null;
  error: string | null;
  result: {sceneId?: string; targetFile?: string; checked?: boolean; dryRun?: boolean} | null;
  logs: string[];
};

type LlmStreamFields = {
  streamLogs?: string[];
  thinking?: string;
  provider?: string;
  error?: string;
};

type ModalType =
  | ({kind: 'tune'; sceneId: string; prompt: string; result: string; loading: boolean} & LlmStreamFields)
  | ({kind: 'design'; sceneId: string; loading: boolean; result?: string} & LlmStreamFields)
  | null;

type BusyAction = string | null;

/* ---------- utils ---------- */

const fetchJson = async <T,>(url: string, opts?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${url}`, opts);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(`接口 ${url} 返回的不是 JSON：${preview}`);
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `${res.status} ${res.statusText}`);
  }
  return data as T;
};

const postJson = <T,>(url: string, body: unknown = {}) =>
  fetchJson<T>(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

type SseHandlers = {
  status?: (payload: any) => void;
  thinking?: (payload: any) => void;
  token?: (payload: any) => void;
  done?: (payload: any) => void;
  error?: (payload: any) => void;
};

const postSse = async (url: string, body: unknown, handlers: SseHandlers) => {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (!res.body) throw new Error('浏览器不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = 'message';
      return;
    }
    const payloadText = dataLines.join('\n');
    dataLines = [];
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (eventName === 'error') {
      handlers.error?.(payload);
      throw new Error(payload.error || 'SSE stream failed');
    }
    handlers[eventName as keyof SseHandlers]?.(payload);
    eventName = 'message';
  };

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) {
        dispatch();
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  if (buffer.trim()) {
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
    dispatch();
  }
};

const formatDuration = (ms: number | null) => {
  if (!ms) return '未生成';
  return `${(ms / 1000).toFixed(1)}s`;
};

const STEP_ORDER: WorkflowStep[] = ['script', 'audio', 'design', 'preview', 'render'];

const STEP_META: Record<WorkflowStep, {label: string; desc: string}> = {
  script: {label: '1. 文案', desc: '编辑每段文案'},
  audio: {label: '2. 语音', desc: 'TTS 生成与时间轴对齐'},
  design: {label: '3. 设计', desc: 'LLM 分析画面方案'},
  preview: {label: '4. 预览', desc: '单段渲染与微调'},
  render: {label: '5. 导出', desc: '渲染完整视频'},
};

const getSceneProgress = (scene: SceneItem) => {
  let completed = 0;
  if (scene.text.trim()) completed++;
  if (scene.audioExists) completed++;
  if (scene.captionExists) completed++;
  if (scene.designNotes?.trim()) completed++;
  if (scene.tuningNotes?.trim()) completed++;
  return completed;
};

const renderPhaseLabel: Record<string, string> = {
  starting: '准备中',
  bundling: '打包中',
  metadata: '读取合成信息',
  rendering: '渲染帧',
  encoding: '编码视频',
  done: '完成',
  failed: '失败',
};

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ---------- components ---------- */

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [render, setRender] = useState<RenderStatus | null>(null);
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [codegen, setCodegen] = useState<CodegenStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [step, setStep] = useState<WorkflowStep>('script');
  const [cacheKey, setCacheKey] = useState(Date.now());
  const [modal, setModal] = useState<ModalType>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const renderPollErrorRef = useRef<string | null>(null);
  const ttsPollErrorRef = useRef<string | null>(null);
  const codegenPollErrorRef = useRef<string | null>(null);
  const pipelineStreamErrorRef = useRef<string | null>(null);

  const selectedScene = useMemo(
    () => scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null,
    [scenes, selectedId],
  );

  const selectedConfigScene = useMemo(
    () => config?.scenes.find((s) => s.id === selectedId) ?? null,
    [config, selectedId],
  );

  const modalConfigScene = useMemo(
    () => (modal ? config?.scenes.find((s) => s.id === modal.sceneId) ?? null : null),
    [config, modal],
  );

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-300), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const noteRenderStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = renderPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`渲染状态刷新失败：${message}`);
      renderPollErrorRef.current = message;
    }
    setRender((current) => {
      const logLine = `[${new Date().toLocaleTimeString()}] 渲染状态刷新失败：${message}`;
      return {
        running: false,
        exitCode: current?.exitCode ?? null,
        startTime: current?.startTime ?? null,
        endTime: current?.endTime ?? Date.now(),
        outputFile: current?.outputFile ?? 'output/video.mp4',
        mode: current?.mode ?? 'full',
        sceneId: current?.sceneId ?? null,
        progress: current?.progress
          ? {...current.progress, phase: 'failed'}
          : {rendered: 0, total: null, encoded: 0, percent: 0, phase: 'failed'},
        logs: isNew ? [...(current?.logs ?? []), logLine].slice(-200) : (current?.logs ?? []),
        error: message,
        videoUrl: current?.videoUrl ?? null,
        videoExists: current?.videoExists ?? false,
      };
    });
  }, [pushLog]);

  const noteTtsStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = ttsPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`语音状态刷新失败：${message}`);
      ttsPollErrorRef.current = message;
    }
    setTtsStatus((current) => ({
      running: false,
      mode: current?.mode ?? null,
      sceneId: current?.sceneId ?? null,
      currentSceneId: current?.currentSceneId ?? null,
      currentIndex: current?.currentIndex ?? 0,
      total: current?.total ?? 0,
      done: current?.done ?? 0,
      step: 'failed',
      message: '语音状态刷新失败',
      taskId: current?.taskId ?? null,
      providerStatus: current?.providerStatus ?? null,
      outputFile: current?.outputFile ?? null,
      startedAt: current?.startedAt ?? null,
      endTime: Date.now(),
      error: message,
      logs: isNew ? [...(current?.logs ?? []), `[${new Date().toLocaleTimeString()}] 语音状态刷新失败：${message}`].slice(-120) : (current?.logs ?? []),
    }));
  }, [pushLog]);

  const noteCodegenStatusError = useCallback((error: unknown) => {
    const message = getErrorMessage(error);
    const isNew = codegenPollErrorRef.current !== message;
    if (isNew) {
      pushLog(`Remotion 代码生成状态刷新失败：${message}`);
      codegenPollErrorRef.current = message;
    }
    setCodegen((current) => ({
      running: false,
      sceneId: current?.sceneId ?? null,
      step: 'failed',
      message: 'Remotion 代码生成状态刷新失败',
      startTime: current?.startTime ?? null,
      endTime: Date.now(),
      targetFile: current?.targetFile ?? null,
      error: message,
      result: current?.result ?? null,
      logs: isNew ? [...(current?.logs ?? []), `[${new Date().toLocaleTimeString()}] Remotion 代码生成状态刷新失败：${message}`].slice(-160) : (current?.logs ?? []),
    }));
  }, [pushLog]);

  const appendModalLog = useCallback((kind: 'tune' | 'design', sceneId: string, line: string) => {
    setModal((current) => {
      if (!current || current.kind !== kind || current.sceneId !== sceneId) return current;
      return {
        ...current,
        streamLogs: [...(current.streamLogs ?? []).slice(-80), `[${new Date().toLocaleTimeString()}] ${line}`],
      };
    });
  }, []);

  const patchModal = useCallback((kind: 'tune' | 'design', sceneId: string, patch: Partial<Exclude<ModalType, null>>) => {
    setModal((current) => {
      if (!current || current.kind !== kind || current.sceneId !== sceneId) return current;
      return {...current, ...patch} as ModalType;
    });
  }, []);

  const refresh = useCallback(async () => {
    const [cfg, sceneStatus] = await Promise.all([
      fetchJson<Config>('/api/config'),
      fetchJson<{fps: number; scenes: SceneItem[]}>('/api/scenes'),
    ]);
    setConfig(cfg);
    setScenes(sceneStatus.scenes);
    try {
      const renderStatus = await fetchJson<RenderStatus>('/api/render/status');
      setRender(renderStatus);
      if (renderPollErrorRef.current) {
        pushLog('渲染状态刷新已恢复');
        renderPollErrorRef.current = null;
      }
    } catch (error) {
      noteRenderStatusError(error);
    }
    if (!selectedId && sceneStatus.scenes[0]) setSelectedId(sceneStatus.scenes[0].id);
  }, [noteRenderStatusError, pushLog, selectedId]);

  useEffect(() => {
    refresh().catch((err) => pushLog(`加载失败：${err.message}`));
  }, [refresh, pushLog]);

  useEffect(() => {
    const es = new EventSource('/api/pipeline/stream');
    es.addEventListener('status', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setPipeline(data.payload);
        pipelineStreamErrorRef.current = null;
      } catch (error) {
        pushLog(`流水线状态解析失败：${getErrorMessage(error)}`);
      }
    });
    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        pushLog(data.payload.text);
      } catch (error) {
        pushLog(`流水线日志解析失败：${getErrorMessage(error)}`);
      }
    });
    es.addEventListener('error', () => {
      if (!pipelineStreamErrorRef.current) {
        pipelineStreamErrorRef.current = 'disconnected';
        pushLog('流水线状态连接中断，正在等待浏览器自动重连');
      }
      setPipeline((current) => (current?.running ? {...current, running: false} : current));
    });
    return () => es.close();
  }, [pushLog]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const status = await fetchJson<RenderStatus>('/api/render/status');
        setRender(status);
        if (renderPollErrorRef.current) {
          pushLog('渲染状态刷新已恢复');
          renderPollErrorRef.current = null;
        }
      } catch (error) {
        noteRenderStatusError(error);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [noteRenderStatusError, pushLog]);

  useEffect(() => {
    let wasRunning = false;
    const poll = async () => {
      try {
        const status = await fetchJson<TtsStatus>('/api/tts/status');
        setTtsStatus(status);
        if (ttsPollErrorRef.current) {
          pushLog('语音状态刷新已恢复');
          ttsPollErrorRef.current = null;
        }
        if (status.running || wasRunning) {
          await refresh();
        }
        wasRunning = status.running;
      } catch (error) {
        wasRunning = false;
        noteTtsStatusError(error);
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [noteTtsStatusError, pushLog, refresh]);

  useEffect(() => {
    let wasRunning = false;
    const poll = async () => {
      try {
        const status = await fetchJson<CodegenStatus>('/api/scene/codegen/status');
        setCodegen(status);
        if (codegenPollErrorRef.current) {
          pushLog('Remotion 代码生成状态刷新已恢复');
          codegenPollErrorRef.current = null;
        }
        if (status.running || wasRunning) {
          await refresh();
          if (!status.running && wasRunning && !status.error) {
            setCacheKey(Date.now());
            pushLog(`${status.sceneId ?? '当前场景'} Remotion 代码生成完成`);
          }
        }
        wasRunning = status.running;
      } catch (error) {
        wasRunning = false;
        noteCodegenStatusError(error);
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [noteCodegenStatusError, pushLog, refresh]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs, render?.logs, codegen?.logs]);

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    pushLog(`开始：${name}`);
    try {
      await action();
      await refresh();
      setCacheKey(Date.now());
      pushLog(`完成：${name}`);
    } catch (error: any) {
      pushLog(`${name} 失败：${error.message || error}`);
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = () =>
    runAction('保存脚本', async () => {
      if (!config) return;
      await postJson('/api/config', config);
      pushLog('脚本配置已保存');
    });

  const updateSceneField = (sceneId: string, field: keyof ScriptScene, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      scenes: config.scenes.map((s) => (s.id === sceneId ? {...s, [field]: value} : s)),
    });
  };

  const updateSceneText = (sceneId: string, text: string) => updateSceneField(sceneId, 'text', text);
  const updateSceneDesign = (sceneId: string, notes: string) => updateSceneField(sceneId, 'designNotes', notes);
  const updateSceneTune = (sceneId: string, notes: string) => updateSceneField(sceneId, 'tuningNotes', notes);

  const runTts = (sceneId: string, force = false) =>
    runAction(`${force ? '重新生成' : '生成'}语音 ${sceneId}`, async () => {
      const result = await postJson<{skipped?: boolean}>('/api/tts', {sceneId, force});
      pushLog(result.skipped ? `${sceneId} 已有语音，跳过 TTS` : `${sceneId} TTS 已生成新语音`);
      setStep('audio');
    });

  const runAsr = (sceneId: string, force = false) =>
    runAction(`${force ? '重做' : '生成'}时间轴对齐 ${sceneId}`, async () => {
      const result = await postJson<{result?: {cues?: Array<{words?: unknown[]}>}}>('/api/asr', {sceneId, force});
      const cueCount = result.result?.cues?.length ?? 0;
      const wordCount = result.result?.cues?.reduce((sum, cue) => sum + (cue.words?.length ?? 0), 0) ?? 0;
      pushLog(`${sceneId} 已重新对齐时间轴：${cueCount} 个片段 / ${wordCount} 个词`);
    });

  const runSceneCodegen = (sceneId: string) =>
    runAction(`生成 Remotion 代码 ${sceneId}`, async () => {
      await postJson('/api/scene/codegen', {sceneId, repairs: 1, check: true});
      const status = await fetchJson<CodegenStatus>('/api/scene/codegen/status');
      setCodegen(status);
      pushLog(`${sceneId} 已启动 Remotion 代码生成`);
      setStep('design');
    });

  const runScenePipeline = (sceneId: string) =>
    runAction(`完整处理 ${sceneId}`, async () => {
      await postJson('/api/pipeline', {sceneId});
      pushLog(`${sceneId} 已启动完整流程：TTS → 时间轴对齐 → manifest`);
    });

  const runAllPipeline = () =>
    runAction('完整处理全部场景', async () => {
      await postJson('/api/pipeline', {});
      pushLog('已启动全部场景完整流程：TTS → 时间轴对齐 → manifest');
    });

  const regenerateAllTts = () =>
    runAction('重做全部语音', async () => {
      await postJson('/api/tts/all', {force: true});
      pushLog('全部语音已重新生成');
      setStep('audio');
    });

  const rebuildManifest = () =>
    runAction('重建视频数据', async () => {
      await postJson('/api/manifest/rebuild', {});
      pushLog('已重建 scenes-manifest.json，每段时长已包含额外 1 秒缓冲');
      setStep('preview');
    });

  const renderVideo = () =>
    runAction('渲染完整视频', async () => {
      await postJson('/api/render', {});
      pushLog('已启动完整视频渲染');
      setStep('render');
    });

  const renderScenePreview = (sceneId: string) =>
    runAction(`渲染本段预览 ${sceneId}`, async () => {
      await postJson('/api/render', {sceneId});
      pushLog(`已启动 ${sceneId} 单段预览渲染`);
      setPreviewVideoUrl(null);
      setStep('preview');
    });

  /* ---------- LLM tune ---------- */
  const requestTune = async () => {
    if (!modal || modal.kind !== 'tune' || !config) return;
    const scene = config.scenes.find((item) => item.id === modal.sceneId);
    if (!scene) return;
    const sceneId = modal.sceneId;
    const prompt = modal.prompt;
    let finalText = '';
    setModal({
      ...modal,
      loading: true,
      result: '',
      thinking: '',
      error: undefined,
      streamLogs: [`[${new Date().toLocaleTimeString()}] 连接 LLM SSE 流...`],
    });
    try {
      await postSse('/api/scene/tune/stream', {
        sceneId,
        text: scene.text,
        prompt,
        currentNotes: scene.tuningNotes ?? '',
      }, {
        status: (payload) => {
          patchModal('tune', sceneId, {provider: payload.provider});
          appendModalLog('tune', sceneId, payload.message || 'LLM 已连接');
        },
        thinking: (payload) => {
          patchModal('tune', sceneId, {thinking: payload.text ?? ''});
        },
        token: (payload) => {
          finalText = payload.text ?? finalText;
          patchModal('tune', sceneId, {result: finalText});
        },
        done: (payload) => {
          finalText = payload.text ?? finalText;
          patchModal('tune', sceneId, {loading: false, result: finalText, provider: payload.provider});
          appendModalLog('tune', sceneId, 'LLM 回复完成');
        },
        error: (payload) => {
          patchModal('tune', sceneId, {error: payload.error, loading: false});
        },
      });
    } catch (error: any) {
      patchModal('tune', sceneId, {loading: false, error: error.message || String(error)});
      appendModalLog('tune', sceneId, `LLM 请求失败：${error.message || error}`);
    }
  };

  const applyTuneResult = () => {
    if (!modal || modal.kind !== 'tune') return;
    updateSceneTune(modal.sceneId, modal.result);
    pushLog(`${modal.sceneId} 已应用 LLM 微调建议到备注，保存脚本后生效`);
    setModal(null);
  };

  /* ---------- LLM design ---------- */
  const requestDesign = async () => {
    if (!modal || modal.kind !== 'design' || !config) return;
    const scene = config.scenes.find((item) => item.id === modal.sceneId);
    const liveScene = scenes.find((item) => item.id === modal.sceneId);
    if (!scene) return;
    const sceneId = modal.sceneId;
    let finalText = '';
    setModal({
      ...modal,
      loading: true,
      result: '',
      thinking: '',
      error: undefined,
      streamLogs: [`[${new Date().toLocaleTimeString()}] 连接 LLM SSE 流...`],
    });
    try {
      await postSse('/api/scene/design/stream', {
        sceneId,
        text: scene.text,
        durationMs: liveScene?.durationMs ?? null,
      }, {
        status: (payload) => {
          patchModal('design', sceneId, {provider: payload.provider});
          appendModalLog('design', sceneId, payload.message || 'LLM 已连接');
        },
        thinking: (payload) => {
          patchModal('design', sceneId, {thinking: payload.text ?? ''});
        },
        token: (payload) => {
          finalText = payload.text ?? finalText;
          patchModal('design', sceneId, {result: finalText});
        },
        done: (payload) => {
          finalText = payload.text ?? finalText;
          updateSceneDesign(sceneId, finalText);
          patchModal('design', sceneId, {loading: false, result: finalText, provider: payload.provider});
          appendModalLog('design', sceneId, 'LLM 回复完成，已写入设计方案');
          pushLog(`${sceneId} LLM 视觉设计方案已生成并写入备注`);
        },
        error: (payload) => {
          patchModal('design', sceneId, {error: payload.error, loading: false});
        },
      });
    } catch (error: any) {
      patchModal('design', sceneId, {loading: false, error: error.message || String(error)});
      appendModalLog('design', sceneId, `LLM 请求失败：${error.message || error}`);
      pushLog(`设计分析失败：${error.message || error}`);
    }
  };

  /* ---------- status ---------- */
  const anyRunning = Boolean(busy || pipeline?.running || render?.running || ttsStatus?.running || codegen?.running || modal?.loading);
  const ttsPercent = ttsStatus?.total
    ? Math.round((ttsStatus.done / ttsStatus.total) * 100)
    : ttsStatus?.running
      ? 5
      : 0;
  const ttsProgressWidth = ttsStatus?.running ? Math.max(ttsPercent, 8) : ttsPercent;
  const ttsStatusText = ttsStatus?.running
    ? `${ttsStatus.currentSceneId ?? '全部'} · ${ttsStatus.message}`
    : ttsStatus?.error
      ? `失败：${ttsStatus.error}`
      : ttsStatus?.message ?? '未开始';
  const isTtsActiveForScene = (sceneId: string) =>
    Boolean(ttsStatus?.running && (ttsStatus.mode === 'all' || ttsStatus.currentSceneId === sceneId || ttsStatus.sceneId === sceneId));
  const isCodegenActiveForScene = (sceneId: string) => Boolean(codegen?.running && codegen.sceneId === sceneId);

  const progress = render?.progress;
  const progressText = progress
    ? `${renderPhaseLabel[progress.phase] ?? progress.phase} · ${progress.percent}%${progress.total ? ` (${progress.rendered}/${progress.total})` : ''}`
    : '未开始';
  const blockingReason = busy
    ? `正在执行：${busy}`
    : modal?.loading
      ? '弹窗任务正在运行'
      : ttsStatus?.running
        ? `语音生成中：${ttsStatusText}`
        : codegen?.running
          ? `Remotion 代码生成中：${codegen.message}`
          : render?.running
          ? `渲染运行中：${progressText}`
          : pipeline?.running
            ? '流水线运行中'
            : null;
  const statusProblem = ttsStatus?.error || codegen?.error || render?.error || null;

  const completedScenes = scenes.filter((s) => s.audioExists && s.captionExists).length;
  const totalScenes = scenes.length;

  if (!config) {
    return (
      <Shell>
        <div style={emptyStyle}>正在加载工作台...</div>
      </Shell>
    );
  }

  return (
    <ErrorBoundary>
    <Shell>
      <div style={layoutStyle}>
        {/* LEFT COLUMN */}
        <section style={leftStyle}>
          <header style={headerStyle}>
            <div>
              <h1 style={titleStyle}>可控视频流水线</h1>
              <p style={subStyle}>
                共 {totalScenes} 段 · 就绪 {completedScenes} 段
                {anyRunning ? ' · 处理中…' : ''}
              </p>
            </div>
            <div style={{display: 'flex', gap: 8}}>
              <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={saveConfig} disabled={anyRunning}>
                保存脚本
              </button>
            </div>
          </header>

          {/* Stepper */}
          <div style={stepperStyle}>
            {STEP_ORDER.map((s) => {
              const active = step === s;
              const clickable =
                s === 'script'
                  ? true
                  : s === 'audio'
                    ? completedScenes > 0 || scenes.some((sc) => sc.audioExists)
                    : s === 'design'
                      ? scenes.some((sc) => sc.captionExists)
                      : s === 'preview'
                        ? scenes.some((sc) => sc.captionExists)
                        : s === 'render'
                          ? completedScenes === totalScenes && totalScenes > 0
                          : true;
              return (
                <button
                  type="button"
                  key={s}
                  style={stepButtonStyle(active, clickable)}
                  onClick={() => clickable && setStep(s)}
                  disabled={!clickable}
                >
                  <span style={stepDotStyle(active)} />
                  <span style={{display: 'block'}}>
                    <span style={{display: 'block', fontWeight: 700, fontSize: 13}}>{STEP_META[s].label}</span>
                    <span style={{display: 'block', fontSize: 11, opacity: 0.7, marginTop: 2}}>{STEP_META[s].desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Global actions per step */}
          <div style={globalActionsStyle}>
            {step === 'script' && (
              <>
                <span style={hintStyle}>编辑左侧每段文案，完成后进入「语音」步骤生成音频。</span>
              </>
            )}
            {step === 'audio' && (
              <>
                <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={regenerateAllTts} disabled={anyRunning}>
                  重做全部语音
                </button>
                <button type="button" style={buttonStyle('#50fa7b', anyRunning)} onClick={runAllPipeline} disabled={anyRunning}>
                  一键语音+对齐全部
                </button>
                <button type="button" style={buttonStyle('#ffb86c', anyRunning)} onClick={rebuildManifest} disabled={anyRunning}>
                  重建预览数据
                </button>
                {ttsStatus?.running ? (
                  <span style={{color: '#50fa7b', fontSize: 12}}>语音生成中：{ttsStatusText}</span>
                ) : null}
              </>
            )}
            {step === 'design' && (
              <>
                <span style={hintStyle}>为每个场景生成视觉设计方案，作为后续绘制的参考。</span>
                <button type="button" style={buttonStyle('#bd93f9', anyRunning)} onClick={rebuildManifest} disabled={anyRunning}>
                  重建预览数据
                </button>
              </>
            )}
            {step === 'preview' && (
              <>
                <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={rebuildManifest} disabled={anyRunning}>
                  重建预览数据
                </button>
                <button type="button" style={buttonStyle('#bd93f9')} onClick={() => window.open(STUDIO_URL, '_blank')}>
                  在 Studio 中打开
                </button>
              </>
            )}
            {step === 'render' && (
              <>
                <button type="button" style={buttonStyle('#ff79c6', anyRunning || completedScenes < totalScenes)} onClick={renderVideo} disabled={anyRunning || completedScenes < totalScenes}>
                  渲染完整视频
                </button>
                {completedScenes < totalScenes && (
                  <span style={{color: '#ff6b6b', fontSize: 12}}>还有 {totalScenes - completedScenes} 段未就绪</span>
                )}
              </>
            )}
          </div>

          {(blockingReason || statusProblem) ? (
            <div style={statusNoticeStyle(statusProblem ? 'error' : 'busy')}>
              {blockingReason ? <span>{blockingReason}</span> : null}
              {statusProblem ? <span>最近错误：{statusProblem}</span> : null}
            </div>
          ) : null}

          {/* Scene list */}
          <div style={sceneListStyle}>
            {config.scenes.map((scene) => {
              const status = scenes.find((item) => item.id === scene.id);
              const live = pipeline?.scenes.find((item) => item.id === scene.id);
              const isSelected = selectedId === scene.id;
              const progress = status ? getSceneProgress(status) : 0;
              const ttsLive = isTtsActiveForScene(scene.id);
              const codegenLive = isCodegenActiveForScene(scene.id);
              return (
                <article
                  key={scene.id}
                  style={{
                    ...sceneCardStyle,
                    borderColor: isSelected ? '#8be9fd' : 'rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={sceneHeaderStyle} onClick={() => setSelectedId(scene.id)}>
                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                      <strong>{scene.id}</strong>
                      <span style={pillStyle(status?.audioExists, status?.captionExists)}>
                        {status?.audioExists && status?.captionExists
                          ? '可预览'
                          : status?.audioExists
                            ? '待对齐'
                            : '待语音'}
                      </span>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                      <StepDots progress={progress} />
                      <span style={{fontSize: 12, color: '#9fb3c8'}}>{formatDuration(status?.durationMs)}</span>
                    </div>
                  </div>

                  {/* Script editing only in script step */}
                  {step === 'script' ? (
                    <div style={{padding: '0 14px 14px'}} onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={scene.text}
                        onChange={(e) => updateSceneText(scene.id, e.target.value)}
                        style={textareaStyle}
                        rows={2}
                      />
                      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6}}>
                        <span style={{fontSize: 12, color: '#9fb3c8'}}>{scene.text.length} 字</span>
                        {scene.tuningNotes ? <span style={{fontSize: 12, color: '#bd93f9'}}>有微调备注</span> : null}
                        {scene.designNotes ? <span style={{fontSize: 12, color: '#50fa7b'}}>有设计方案</span> : null}
                      </div>
                    </div>
                  ) : (
                    <div style={{padding: '0 14px 14px', fontSize: 14, color: '#c8dcff', lineHeight: 1.6}} onClick={() => setSelectedId(scene.id)}>
                      {scene.text}
                      {scene.tuningNotes || scene.designNotes ? (
                        <div style={{display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap'}}>
                          {scene.designNotes ? <span style={badgeStyle('#50fa7b')}>设计</span> : null}
                          {scene.tuningNotes ? <span style={badgeStyle('#bd93f9')}>微调</span> : null}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Action row */}
                  <div style={actionRowStyle}>
                    {step === 'audio' && (
                      <>
                        <MiniBtn
                          disabled={anyRunning}
                          onClick={() => runTts(scene.id, Boolean(status?.audioExists))}
                        >
                          {status?.audioExists ? '重新生成语音' : '生成语音'}
                        </MiniBtn>
                        <MiniBtn disabled={anyRunning || !status?.audioExists} onClick={() => runAsr(scene.id)}>
                          对齐时间轴
                        </MiniBtn>
                        <MiniBtn disabled={anyRunning} onClick={() => runScenePipeline(scene.id)}>
                          本段全流程
                        </MiniBtn>
                      </>
                    )}
                    {step === 'design' && (
                      <>
                        <MiniBtn
                          disabled={anyRunning}
                          onClick={() => setModal({kind: 'design', sceneId: scene.id, loading: false})}
                        >
                          {scene.designNotes ? '重新设计' : '生成设计方案'}
                        </MiniBtn>
                        <MiniBtn
                          disabled={anyRunning || !status?.captionExists}
                          onClick={() => runSceneCodegen(scene.id)}
                        >
                          生成 Remotion 代码
                        </MiniBtn>
                      </>
                    )}
                    {step === 'preview' && (
                      <>
                        <MiniBtn
                          disabled={anyRunning || !status?.audioExists}
                          onClick={() => renderScenePreview(scene.id)}
                        >
                          渲染本段预览
                        </MiniBtn>
                        <MiniBtn
                          disabled={anyRunning}
                          onClick={() => setModal({kind: 'tune', sceneId: scene.id, prompt: '', result: '', loading: false})}
                        >
                          LLM 微调
                        </MiniBtn>
                      </>
                    )}
                    {codegenLive ? (
                      <span style={{fontSize: 12, color: '#bd93f9', marginLeft: 'auto'}}>
                        Remotion 代码生成中：{codegen?.message}
                      </span>
                    ) : ttsLive ? (
                      <span style={{fontSize: 12, color: '#50fa7b', marginLeft: 'auto'}}>
                        语音生成中：{ttsStatus?.message}
                      </span>
                    ) : live ? (
                      <span style={{fontSize: 12, color: '#8be9fd', marginLeft: 'auto'}}>
                        运行中：{live.step}/{live.status}
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* RIGHT COLUMN */}
        <aside style={rightStyle}>
          <div style={rightHeaderStyle}>
            <h2 style={{margin: 0, fontSize: 16}}>
              {selectedScene ? `${selectedScene.id} · ${STEP_META[step].label}` : '请选择场景'}
            </h2>
            <p style={{margin: '4px 0 0', fontSize: 12, color: '#9fb3c8'}}>
              {selectedScene ? formatDuration(selectedScene.durationMs) : ''}
            </p>
          </div>

          <div style={{flex: 1, minHeight: 0, overflow: 'auto', padding: 16}}>
            {!selectedScene ? (
              <div style={emptyStyle}>在左侧选择一个场景</div>
            ) : (
              <>
                {/* SCRIPT PANEL */}
                {step === 'script' && (
                  <Panel title="文案编辑" subtitle={`${selectedScene.id} · ${selectedScene.text.length} 字`}>
                    <textarea
                      value={selectedConfigScene?.text ?? ''}
                      onChange={(e) => updateSceneText(selectedScene.id, e.target.value)}
                      style={{...textareaStyle, minHeight: 120}}
                      rows={4}
                    />
                    <p style={hintStyle}>修改文案后点击左上角「保存脚本」生效。</p>
                  </Panel>
                )}

                {/* AUDIO PANEL */}
                {step === 'audio' && (
                  <>
                    <Panel title="语音生成状态" subtitle={ttsStatus?.running ? ttsStatusText : (ttsStatus?.message ?? '未开始')}>
                      <div style={progressWrapStyle}>
                        <div style={{...progressBarStyle, width: `${ttsProgressWidth}%`}} />
                      </div>
                      <div style={{marginTop: 10, display: 'grid', gap: 6, fontSize: 12, color: '#9fb3c8'}}>
                        <div>
                          {ttsStatus?.total ? `${ttsStatus.done}/${ttsStatus.total}` : '0/0'}
                          {ttsStatus?.taskId ? ` · taskId=${ttsStatus.taskId}` : ''}
                          {ttsStatus?.providerStatus !== null && ttsStatus?.providerStatus !== undefined ? ` · 状态=${ttsStatus.providerStatus}` : ''}
                        </div>
                        {ttsStatus?.error ? <div style={{color: '#ff6b6b'}}>{ttsStatus.error}</div> : null}
                      </div>
                      {ttsStatus?.logs?.length ? (
                        <div style={{...logBoxStyle, maxHeight: 150, marginTop: 10}}>
                          {ttsStatus.logs.slice(-20).map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      ) : null}
                    </Panel>

                    <Panel title="语音试听" subtitle={selectedScene.audioExists ? '已生成' : '未生成'}>
                      {selectedScene.audioExists ? (
                        <audio
                          key={`${selectedScene.id}-${cacheKey}`}
                          controls
                          src={`${selectedScene.audioUrl}?t=${cacheKey}`}
                          style={{width: '100%'}}
                        />
                      ) : (
                        <div style={emptyStyle}>当前场景还没有语音。</div>
                      )}
                    </Panel>

                    <Panel title="语音时间轴" subtitle={selectedScene.captionExists ? '已对齐' : '未对齐'}>
                      {selectedScene.captionExists ? (
                        <CaptionTimeline scene={selectedScene} />
                      ) : (
                        <div style={emptyStyle}>先运行语音时间轴对齐。</div>
                      )}
                    </Panel>
                  </>
                )}

                {/* DESIGN PANEL */}
                {step === 'design' && (
                  <>
                    <Panel title="视觉设计方案" subtitle={selectedConfigScene?.designNotes ? '已有方案' : '未生成'}>
                      {selectedConfigScene?.designNotes ? (
                        <pre style={markdownPreviewStyle}>{selectedConfigScene.designNotes}</pre>
                      ) : (
                        <div style={emptyStyle}>点击「生成设计方案」让 LLM 分析画面布局。</div>
                      )}
                      <div style={{display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap'}}>
                        <button
                          type="button"
                          style={buttonStyle('#bd93f9', anyRunning)}
                          onClick={() =>
                            setModal({kind: 'design', sceneId: selectedScene.id, loading: false})
                          }
                          disabled={anyRunning}
                        >
                          重新生成设计方案
                        </button>
                        <button
                          type="button"
                          style={buttonStyle('#50fa7b', anyRunning || !selectedScene.captionExists)}
                          onClick={() => runSceneCodegen(selectedScene.id)}
                          disabled={anyRunning || !selectedScene.captionExists}
                        >
                          生成 Remotion 代码
                        </button>
                      </div>
                    </Panel>

                    <Panel
                      title="Remotion 代码生成"
                      subtitle={codegen?.running ? codegen.message : (codegen?.targetFile ?? '未生成')}
                    >
                      {!selectedScene.captionExists ? (
                        <div style={emptyStyle}>先完成语音时间轴对齐，再生成 Remotion 场景代码。</div>
                      ) : (
                        <div style={{display: 'grid', gap: 10}}>
                          <div style={{fontSize: 12, color: codegen?.error ? '#ff6b6b' : '#9fb3c8'}}>
                            {codegen?.error
                              ? codegen.error
                              : codegen?.sceneId
                                ? `${codegen.sceneId} · ${codegen.step}`
                                : '等待生成'}
                          </div>
                          {codegen?.logs?.length ? (
                            <div style={{...logBoxStyle, maxHeight: 180}}>
                              {codegen.logs.slice(-24).map((line, i) => (
                                <div key={i}>{line}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </Panel>
                  </>
                )}

                {/* PREVIEW PANEL */}
                {step === 'preview' && (
                  <>
                    <Panel title="本段视频预览" subtitle={render?.sceneId === selectedScene.id ? render.outputFile : '未渲染'}>
                      {(() => {
                        const url =
                          render?.sceneId === selectedScene.id && render.videoExists
                            ? render.videoUrl
                            : previewVideoUrl;
                        return url ? (
                          <video key={url} controls src={url} style={videoStyle} />
                        ) : (
                          <div style={emptyStyle}>点击「渲染本段预览」生成视频。</div>
                        );
                      })()}
                    </Panel>

                    <Panel title="LLM 微调" subtitle={selectedConfigScene?.tuningNotes ? '已有备注' : '未微调'}>
                      {selectedConfigScene?.tuningNotes ? (
                        <pre style={markdownPreviewStyle}>{selectedConfigScene.tuningNotes}</pre>
                      ) : (
                        <div style={emptyStyle}>通过 LLM 获取画面、节奏、字幕和动效的微调建议。</div>
                      )}
                      <button
                        type="button"
                        style={{...buttonStyle('#8be9fd', anyRunning), marginTop: 12}}
                        onClick={() =>
                          setModal({kind: 'tune', sceneId: selectedScene.id, prompt: '', result: '', loading: false})
                        }
                        disabled={anyRunning}
                      >
                        打开微调助手
                      </button>
                    </Panel>

                    <Panel title="Studio 完整预览" subtitle="查看全部场景衔接">
                      <div style={{...emptyStyle, minHeight: 120}}>
                        <p>Remotion Studio 需要单独启动：</p>
                        <code style={{display: 'block', marginTop: 8, padding: 8, background: '#05070d', borderRadius: 8}}>
                          npx remotion studio
                        </code>
                        <button
                          type="button"
                          style={{...buttonStyle('#bd93f9'), marginTop: 12}}
                          onClick={() => window.open(STUDIO_URL, '_blank')}
                        >
                          打开 Studio（新窗口）
                        </button>
                      </div>
                    </Panel>
                  </>
                )}

                {/* RENDER PANEL */}
                {step === 'render' && (
                  <>
                    <Panel title="渲染进度" subtitle={render?.running ? progressText : render?.error ? '失败' : '就绪'}>
                      <div style={progressWrapStyle}>
                        <div style={{...progressBarStyle, width: `${progress?.percent ?? 0}%`}} />
                      </div>
                      <div style={{marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                        <button type="button" style={buttonStyle('#ff79c6', anyRunning)} onClick={renderVideo} disabled={anyRunning}>
                          {render?.running ? '渲染中…' : '开始渲染完整视频'}
                        </button>
                      </div>
                    </Panel>

                    <Panel title="视频结果" subtitle={render?.videoExists ? '可播放' : '暂无视频'}>
                      {render?.videoExists ? (
                        <>
                          <video
                            key={render.videoUrl}
                            controls
                            src={render.videoUrl}
                            style={videoStyle}
                          />
                          <a
                            href={render.videoUrl}
                            download
                            style={{display: 'inline-block', marginTop: 8, color: '#8be9fd'}}
                          >
                            下载视频
                          </a>
                        </>
                      ) : (
                        <div style={emptyStyle}>渲染完成后在此预览和下载。</div>
                      )}
                    </Panel>

                    <Panel title="渲染日志" subtitle={progressText}>
                      <div style={{...logBoxStyle, minHeight: 200}} ref={logsRef}>
                        {[...logs, ...(render?.logs ?? [])].slice(-200).map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                        {anyRunning ? <div style={{color: '#8be9fd'}}>处理中...</div> : null}
                      </div>
                    </Panel>
                  </>
                )}

                {step !== 'render' && logs.length ? (
                  <Panel title="操作日志" subtitle={blockingReason ?? '最近操作'}>
                    <div style={{...logBoxStyle, maxHeight: 180}}>
                      {logs.slice(-120).map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                      {anyRunning ? <div style={{color: '#8be9fd'}}>处理中...</div> : null}
                    </div>
                  </Panel>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* MODALS */}
      {modal?.kind === 'tune' && (
        <div style={modalBackdropStyle} onClick={() => setModal(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{marginTop: 0}}>LLM 微调 · {modal.sceneId}</h2>
            <p style={hintStyle}>描述你想调整的视觉效果、节奏、镜头、文字动画或情绪。</p>
            <textarea
              style={{...textareaStyle, minHeight: 110}}
              value={modal.prompt}
              onChange={(e) => setModal({...modal, prompt: e.target.value})}
              placeholder="例如：这一段节奏太平，想要更强的冲击感，字幕出现更快，背景更有科技感。"
            />
            <div style={{display: 'flex', gap: 8, margin: '12px 0'}}>
              <button
                type="button"
                style={buttonStyle('#8be9fd', modal.loading || !modal.prompt.trim())}
                onClick={requestTune}
                disabled={modal.loading || !modal.prompt.trim()}
              >
                {modal.loading ? '生成中...' : '生成微调建议'}
              </button>
              <button type="button" style={buttonStyle('#50fa7b', !modal.result.trim())} onClick={applyTuneResult} disabled={!modal.result.trim()}>
                应用建议
              </button>
              <button type="button" style={buttonStyle('#ff6b6b')} onClick={() => setModal(null)}>
                关闭
              </button>
            </div>
            <LlmStreamPanel
              logs={modal.streamLogs}
              thinking={modal.thinking}
              result={modal.result}
              error={modal.error}
              provider={modal.provider}
            />
          </div>
        </div>
      )}

      {modal?.kind === 'design' && (
        <div style={modalBackdropStyle} onClick={() => setModal(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{marginTop: 0}}>视觉设计方案 · {modal.sceneId}</h2>
            <p style={hintStyle}>调用 LLM 根据文案和时长分析最佳画面布局、色彩和动画节奏。</p>
            <div style={{display: 'flex', gap: 8, margin: '12px 0'}}>
              <button
                type="button"
                style={buttonStyle('#bd93f9', modal.loading)}
                onClick={requestDesign}
                disabled={modal.loading}
              >
                {modal.loading ? '分析中...' : '生成设计方案'}
              </button>
              <button type="button" style={buttonStyle('#ff6b6b')} onClick={() => setModal(null)}>
                关闭
              </button>
            </div>
            <LlmStreamPanel
              logs={modal.streamLogs}
              thinking={modal.thinking}
              result={modal.result ?? modalConfigScene?.designNotes ?? ''}
              error={modal.error}
              provider={modal.provider}
            />
          </div>
        </div>
      )}
    </Shell>
    </ErrorBoundary>
  );
}

/* ---------- sub-components ---------- */

function Shell({children}: {children: React.ReactNode}) {
  return <div style={shellStyle}>{children}</div>;
}

function Panel({title, subtitle, children}: {title: string; subtitle: string; children: React.ReactNode}) {
  return (
    <div style={panelCardStyle}>
      <div style={{marginBottom: 12}}>
        <h3 style={{margin: 0, fontSize: 15}}>{title}</h3>
        <p style={{margin: '4px 0 0', fontSize: 12, color: '#9fb3c8'}}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function LlmStreamPanel({
  logs = [],
  thinking = '',
  result = '',
  error,
  provider,
}: {
  logs?: string[];
  thinking?: string;
  result?: string;
  error?: string;
  provider?: string;
}) {
  if (!logs.length && !thinking && !result && !error && !provider) return null;
  return (
    <div style={{display: 'grid', gap: 10, marginTop: 12}}>
      <div style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
        {provider ? <span style={badgeStyle('#8be9fd')}>provider: {provider}</span> : null}
        {error ? <span style={badgeStyle('#ff6b6b')}>error</span> : null}
      </div>
      {logs.length ? (
        <div style={{...logBoxStyle, maxHeight: 120}}>
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
      {thinking ? (
        <div>
          <div style={streamLabelStyle}>思考过程</div>
          <pre style={thinkingPreviewStyle}>{thinking}</pre>
        </div>
      ) : null}
      {result ? (
        <div>
          <div style={streamLabelStyle}>实时回复</div>
          <pre style={tuneResultStyle}>{result}</pre>
        </div>
      ) : null}
      {error ? <pre style={{...tuneResultStyle, color: '#ffb4b4'}}>{error}</pre> : null}
    </div>
  );
}

function MiniBtn({children, disabled, onClick}: {children: React.ReactNode; disabled?: boolean; onClick?: () => void}) {
  return (
    <button type="button" style={miniButtonStyle('#8be9fd', Boolean(disabled))} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {children}
    </button>
  );
}

function StepDots({progress}: {progress: number}) {
  return (
    <div style={{display: 'flex', gap: 4}}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: i <= progress ? '#50fa7b' : 'rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </div>
  );
}

function CaptionTimeline({scene}: {scene: SceneItem}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!scene.captionsUrl) return;
    fetch(`${scene.captionsUrl}?t=${Date.now()}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [scene.captionsUrl]);

  if (!data?.cues?.length) return <div style={emptyStyle}>加载时间轴数据中...</div>;

  const totalFrames = data.durationInFrames || data.cues[data.cues.length - 1]?.endFrame || 1;
  const pxPerFrame = 800 / totalFrames;

  return (
    <div style={{overflowX: 'auto'}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 6, minWidth: 600}}>
        {data.cues.map((cue: any) => {
          const left = (cue.startFrame / totalFrames) * 100;
          const width = ((cue.endFrame - cue.startFrame) / totalFrames) * 100;
          return (
            <div key={cue.id} style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <div style={{width: 60, fontSize: 11, color: '#9fb3c8', flexShrink: 0, textAlign: 'right'}}>
                {(cue.startFrame / 30).toFixed(1)}s
              </div>
              <div style={{flex: 1, position: 'relative', height: 28, background: 'rgba(255,255,255,0.04)', borderRadius: 6}}>
                <div
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    top: 4,
                    bottom: 4,
                    background: 'rgba(139,233,253,0.25)',
                    borderRadius: 4,
                    border: '1px solid rgba(139,233,253,0.4)',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    paddingLeft: 6,
                    fontSize: 12,
                    color: '#e6edf3',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '90%',
                  }}
                >
                  {cue.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{...hintStyle, marginTop: 8}}>
        共 {data.cues.length} 个片段 · {data.wordCount ?? data.cues.reduce((sum: number, cue: any) => sum + (cue.words?.length ?? 0), 0)} 个词/字 ·
        总时长 {formatDuration(Math.round((totalFrames / 30) * 1000))}
        {data.alignmentSource ? ` · ${data.alignmentSource === 'asr' ? 'ASR' : '估算'}对齐` : ''}
      </p>
    </div>
  );
}

/* ---------- styles ---------- */

const shellStyle: React.CSSProperties = {height: '100vh', background: '#0b1020', color: '#e6edf3', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', overflow: 'hidden'};
const layoutStyle: React.CSSProperties = {height: '100%', display: 'grid', gridTemplateColumns: 'minmax(560px, 1fr) 46%', gap: 0};
const leftStyle: React.CSSProperties = {padding: 20, overflow: 'auto', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column'};
const rightStyle: React.CSSProperties = {display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: '#080c18'};
const rightHeaderStyle: React.CSSProperties = {padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)'};
const headerStyle: React.CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 14};
const titleStyle: React.CSSProperties = {margin: 0, fontSize: 22};
const subStyle: React.CSSProperties = {margin: '6px 0 0', color: '#9fb3c8', fontSize: 13};
const stepperStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14};
const globalActionsStyle: React.CSSProperties = {display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, minHeight: 36};
const sceneListStyle: React.CSSProperties = {display: 'grid', gap: 10};
const sceneCardStyle: React.CSSProperties = {background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12};
const sceneHeaderStyle: React.CSSProperties = {display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer'};
const textareaStyle: React.CSSProperties = {width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: '#070b16', color: '#e6edf3', padding: 10, lineHeight: 1.5, fontSize: 14};
const actionRowStyle: React.CSSProperties = {display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 14px 12px'};
const panelCardStyle: React.CSSProperties = {background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, marginBottom: 12};
const videoStyle: React.CSSProperties = {width: '100%', maxHeight: '56vh', background: '#000', borderRadius: 12};
const logBoxStyle: React.CSSProperties = {overflow: 'auto', background: '#05070d', borderRadius: 12, padding: 12, fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320};
const emptyStyle: React.CSSProperties = {display: 'grid', placeItems: 'center', minHeight: 160, color: '#9fb3c8', textAlign: 'center', fontSize: 13};
const hintStyle: React.CSSProperties = {color: '#9fb3c8', fontSize: 13};
const progressWrapStyle: React.CSSProperties = {height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden'};
const progressBarStyle: React.CSSProperties = {height: '100%', background: 'linear-gradient(90deg, #8be9fd, #50fa7b)', transition: 'width 0.2s'};
const statusNoticeStyle = (tone: 'busy' | 'error'): React.CSSProperties => ({
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  border: `1px solid ${tone === 'error' ? 'rgba(255,107,107,0.35)' : 'rgba(139,233,253,0.28)'}`,
  background: tone === 'error' ? 'rgba(255,107,107,0.09)' : 'rgba(139,233,253,0.08)',
  color: tone === 'error' ? '#ffb4b4' : '#c8f6ff',
  borderRadius: 8,
  padding: '9px 12px',
  marginBottom: 12,
  fontSize: 12,
  lineHeight: 1.45,
});
const modalBackdropStyle: React.CSSProperties = {position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'grid', placeItems: 'center', zIndex: 20};
const modalStyle: React.CSSProperties = {width: 'min(720px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: '#11182c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.45)'};
const tuneResultStyle: React.CSSProperties = {whiteSpace: 'pre-wrap', background: '#05070d', borderRadius: 12, padding: 12, color: '#e6edf3', maxHeight: 260, overflow: 'auto', fontSize: 13, lineHeight: 1.6};
const markdownPreviewStyle: React.CSSProperties = {whiteSpace: 'pre-wrap', background: '#05070d', borderRadius: 12, padding: 12, color: '#c8dcff', fontSize: 13, lineHeight: 1.7};
const thinkingPreviewStyle: React.CSSProperties = {whiteSpace: 'pre-wrap', background: '#07101e', borderRadius: 12, padding: 12, color: '#b8c7ff', maxHeight: 180, overflow: 'auto', fontSize: 12, lineHeight: 1.6, border: '1px solid rgba(139,233,253,0.12)'};
const streamLabelStyle: React.CSSProperties = {fontSize: 12, color: '#9fb3c8', marginBottom: 6, fontWeight: 700};

function buttonStyle(color: string, disabled = false): React.CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.05)' : `${color}18`,
    color: disabled ? '#6f8098' : color,
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.12)' : `${color}55`}`,
    borderRadius: 10,
    padding: '9px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: 13,
    opacity: disabled ? 0.62 : 1,
  };
}

function miniButtonStyle(color = '#8be9fd', disabled = false): React.CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.04)' : `${color}12`,
    color: disabled ? '#617089' : color,
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.1)' : `${color}25`}`,
    borderRadius: 8,
    padding: '6px 10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
    opacity: disabled ? 0.58 : 1,
  };
}

function pillStyle(audio = false, caption = false): React.CSSProperties {
  const color = audio && caption ? '#50fa7b' : audio ? '#ffb86c' : '#ff6b6b';
  return {fontSize: 11, color, border: `1px solid ${color}55`, borderRadius: 999, padding: '3px 8px', background: `${color}14`};
}

function badgeStyle(color: string): React.CSSProperties {
  return {fontSize: 11, color, border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', background: `${color}12`};
}

function stepButtonStyle(active: boolean, clickable: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 8px',
    borderRadius: 10,
    border: `1px solid ${active ? 'rgba(139,233,253,0.35)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(139,233,253,0.08)' : 'rgba(255,255,255,0.02)',
    color: clickable ? '#e6edf3' : '#5a6a80',
    cursor: clickable ? 'pointer' : 'not-allowed',
    textAlign: 'left',
    opacity: clickable ? 1 : 0.6,
  };
}

function stepDotStyle(active: boolean): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
    background: active ? '#8be9fd' : 'rgba(255,255,255,0.2)',
    boxShadow: active ? '0 0 8px #8be9fd80' : 'none',
  };
}
