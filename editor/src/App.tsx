import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {formatDuration, getErrorMessage, renderPhaseLabel, STEP_META, STUDIO_URL} from './app/workflow';
import {TuneCodegenDialog} from './components/TuneCodegenDialog';
import {Panel} from './components/ui/Panel';
import {Shell} from './components/ui/Shell';
import {CaptionTimeline} from './features/audio/CaptionTimeline';
import {DesignDialog} from './features/design/DesignDialog';
import {SceneList} from './features/scenes/SceneList';
import {SceneAssetsPanel} from './features/scenes/SceneAssetsPanel';
import {WorkflowActions} from './features/workflow/WorkflowActions';
import {WorkflowStepper} from './features/workflow/WorkflowStepper';
import {fetchJson, postJson, postSse} from './services/api/client';
import type {
  BusyAction,
  CodegenStatus,
  Config,
  ModalType,
  PipelineStatus,
  RenderStatus,
  SceneAsset,
  SceneAssetRole,
  SceneItem,
  ScriptScene,
  TtsStatus,
  WorkflowStep,
} from './types';

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
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneDescribe, setCloneDescribe] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetRole, setAssetRole] = useState<SceneAssetRole>('reference');
  const [assetNotes, setAssetNotes] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [tuneDialogOpen, setTuneDialogOpen] = useState(false);
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
      provider: current?.provider ?? null,
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

  const appendModalLog = useCallback((kind: 'design', sceneId: string, line: string) => {
    setModal((current) => {
      if (!current || current.kind !== kind || current.sceneId !== sceneId) return current;
      return {
        ...current,
        streamLogs: [...(current.streamLogs ?? []).slice(-80), `[${new Date().toLocaleTimeString()}] ${line}`],
      };
    });
  }, []);

  const patchModal = useCallback((kind: 'design', sceneId: string, patch: Partial<Exclude<ModalType, null>>) => {
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

  const updateConfigField = <K extends keyof Config>(field: K, value: Config[K]) => {
    if (!config) return;
    setConfig({...config, [field]: value});
  };

  const updateSceneField = (sceneId: string, field: keyof ScriptScene, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      scenes: config.scenes.map((s) => (s.id === sceneId ? {...s, [field]: value} : s)),
    });
  };

  const updateSceneText = (sceneId: string, text: string) => updateSceneField(sceneId, 'text', text);
  const updateSceneDesign = (sceneId: string, notes: string) => updateSceneField(sceneId, 'designNotes', notes);

  const runTts = (sceneId: string, force = false) =>
    runAction(`${force ? '重新生成' : '生成'}语音 ${sceneId}`, async () => {
      const result = await postJson<{skipped?: boolean}>('/api/tts', {sceneId, force});
      pushLog(result.skipped ? `${sceneId} 已有语音，跳过 TTS` : `${sceneId} TTS 已生成新语音`);
      setStep('audio');
    });

  const uploadVoiceClone = async () => {
    if (!cloneFile || !cloneName.trim()) return;
    setCloneLoading(true);
    pushLog(`开始创建克隆声音：${cloneName.trim()}`);
    try {
      const form = new FormData();
      form.append('file', cloneFile);
      form.append('name', cloneName.trim());
      form.append('describe', cloneDescribe.trim());
      const res = await fetch('/api/tts/clone', {method: 'POST', body: form});
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data?.error || text || res.statusText);
      setConfig(data.config);
      setCloneFile(null);
      setCloneName('');
      setCloneDescribe('');
      await refresh();
      pushLog(`克隆声音已启用：${data.data?.name ?? '未命名'} · audioId=${data.data?.audioId ?? ''}`);
    } catch (error) {
      pushLog(`克隆声音创建失败：${getErrorMessage(error)}`);
    } finally {
      setCloneLoading(false);
    }
  };

  const uploadSceneAsset = async (sceneId: string) => {
    if (!assetFile) return;
    setAssetLoading(true);
    pushLog(`开始上传 ${sceneId} 图片：${assetFile.name}`);
    try {
      const form = new FormData();
      form.append('sceneId', sceneId);
      form.append('role', assetRole);
      form.append('notes', assetNotes.trim());
      form.append('file', assetFile);
      const data = await fetchJson<{config: Config; asset?: SceneAsset}>('/api/scene/assets', {
        method: 'POST',
        body: form,
      });
      setConfig(data.config);
      setAssetFile(null);
      setAssetNotes('');
      await refresh();
      pushLog(`${sceneId} 图片已上传为 ${assetRole}：${data.asset?.name ?? assetFile.name}`);
    } catch (error) {
      pushLog(`图片上传失败：${getErrorMessage(error)}`);
    } finally {
      setAssetLoading(false);
    }
  };

  const deleteSceneAsset = (sceneId: string, assetId: string) =>
    runAction(`删除图片 ${assetId}`, async () => {
      const result = await postJson<{config: Config}>('/api/scene/assets/delete', {sceneId, assetId});
      setConfig(result.config);
      await refresh();
      pushLog(`${sceneId} 图片已删除`);
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
      if (config) {
        await postJson('/api/config', config);
        pushLog('已自动保存当前脚本和画面描述');
      }
      await postJson('/api/scene/codegen', {
        sceneId,
        provider: 'openai',
        repairs: 2,
        check: true,
      });
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

  /* ---------- LLM design ---------- */
  const requestDesign = async () => {
    if (!modal || modal.kind !== 'design' || !config) return;
    const scene = config.scenes.find((item) => item.id === modal.sceneId);
    const liveScene = scenes.find((item) => item.id === modal.sceneId);
    if (!scene) return;
    const sceneId = modal.sceneId;
    const prompt = modal.prompt.trim();
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
      if (assetFile) {
        appendModalLog('design', sceneId, `上传图片：${assetFile.name} · ${assetRole}`);
        await uploadSceneAsset(sceneId);
        appendModalLog('design', sceneId, '图片已写入场景素材上下文');
      }
      await postSse('/api/scene/design/stream', {
        sceneId,
        text: scene.text,
        durationMs: liveScene?.durationMs ?? null,
        prompt,
        currentDesignNotes: scene.designNotes ?? '',
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
  const anyRunning = Boolean(busy || pipeline?.running || render?.running || ttsStatus?.running || codegen?.running || modal?.loading || cloneLoading || assetLoading);
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
            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end'}}>
              <input
                aria-label="LLM model"
                value={config.llmModel ?? ''}
                onChange={(e) => updateConfigField('llmModel', e.target.value)}
                placeholder="gpt-5.5"
                style={modelInputStyle}
                disabled={anyRunning}
              />
              <button type="button" style={buttonStyle('#8be9fd', anyRunning)} onClick={saveConfig} disabled={anyRunning}>
                保存脚本
              </button>
            </div>
          </header>

          <WorkflowStepper
            step={step}
            scenes={scenes}
            completedScenes={completedScenes}
            totalScenes={totalScenes}
            onStepChange={setStep}
          />

          <WorkflowActions
            step={step}
            anyRunning={anyRunning}
            completedScenes={completedScenes}
            totalScenes={totalScenes}
            ttsRunning={Boolean(ttsStatus?.running)}
            ttsStatusText={ttsStatusText}
            onRegenerateAllTts={regenerateAllTts}
            onRunAllPipeline={runAllPipeline}
            onRebuildManifest={rebuildManifest}
            onRenderVideo={renderVideo}
            onOpenStudio={() => window.open(STUDIO_URL, '_blank')}
          />

          {(blockingReason || statusProblem) ? (
            <div style={statusNoticeStyle(statusProblem ? 'error' : 'busy')}>
              {blockingReason ? <span>{blockingReason}</span> : null}
              {statusProblem ? <span>最近错误：{statusProblem}</span> : null}
            </div>
          ) : null}

          <SceneList
            configScenes={config.scenes}
            sceneStatuses={scenes}
            pipeline={pipeline}
            selectedId={selectedId}
            step={step}
            anyRunning={anyRunning}
            ttsStatus={ttsStatus}
            codegen={codegen}
            onSelect={setSelectedId}
            onUpdateSceneText={updateSceneText}
            onRunTts={runTts}
            onRunAsr={runAsr}
            onRunScenePipeline={runScenePipeline}
            onOpenDesign={(sceneId) => setModal({kind: 'design', sceneId, prompt: '', loading: false})}
            onRunSceneCodegen={runSceneCodegen}
            onRenderScenePreview={renderScenePreview}
            onOpenTune={(sceneId) => {
              setSelectedId(sceneId);
              setTuneDialogOpen(true);
            }}
          />
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
                  <>
                    <Panel title="文案编辑" subtitle={`${selectedScene.id} · ${selectedScene.text.length} 字`}>
                      <textarea
                        value={selectedConfigScene?.text ?? ''}
                        onChange={(e) => updateSceneText(selectedScene.id, e.target.value)}
                        style={{...textareaStyle, minHeight: 120}}
                        rows={4}
                      />
                      <p style={hintStyle}>修改文案后点击左上角「保存脚本」生效。</p>
                    </Panel>

                    <Panel title="OpenAI / LLM 配置" subtitle="用于设计生成和 OpenAI provider">
                      <div style={llmConfigGridStyle}>
                        <label style={fieldLabelStyle}>
                          Base URL
                          <input
                            value={config.llmBaseUrl ?? ''}
                            onChange={(e) => updateConfigField('llmBaseUrl', e.target.value)}
                            placeholder="https://api.openai.com"
                            disabled={anyRunning}
                            style={smallInputStyle}
                          />
                        </label>
                        <label style={fieldLabelStyle}>
                          API Key
                          <input
                            type="password"
                            value={config.llmApiKey ?? ''}
                            onChange={(e) => updateConfigField('llmApiKey', e.target.value)}
                            placeholder="sk-..."
                            disabled={anyRunning}
                            style={smallInputStyle}
                            autoComplete="off"
                          />
                        </label>
                        <label style={fieldLabelStyle}>
                          Model
                          <input
                            value={config.llmModel ?? ''}
                            onChange={(e) => updateConfigField('llmModel', e.target.value)}
                            placeholder="gpt-5.5"
                            disabled={anyRunning}
                            style={smallInputStyle}
                          />
                        </label>
                      </div>
                      <p style={hintStyle}>这里会写入 src/composer/script.json；如果使用 Kimi Wire，这些字段主要影响设计方案等 OpenAI 兼容接口调用。</p>
                    </Panel>
                  </>
                )}

                {/* AUDIO PANEL */}
                {step === 'audio' && (
                  <>
                    <Panel title="声音克隆" subtitle={config.ttsVoiceName ? `${config.ttsVoiceName} · ${config.ttsAudioId}` : `当前 audioId=${config.ttsAudioId || '未设置'}`}>
                      <div style={voiceCloneGridStyle}>
                        <input
                          type="file"
                          accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
                          onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)}
                          disabled={cloneLoading || anyRunning}
                          style={fileInputStyle}
                        />
                        <input
                          value={cloneName}
                          onChange={(e) => setCloneName(e.target.value)}
                          placeholder="模型名称"
                          disabled={cloneLoading || anyRunning}
                          style={smallInputStyle}
                        />
                        <input
                          value={cloneDescribe}
                          onChange={(e) => setCloneDescribe(e.target.value)}
                          placeholder="模型描述"
                          disabled={cloneLoading || anyRunning}
                          style={smallInputStyle}
                        />
                        <button
                          type="button"
                          style={buttonStyle('#50fa7b', cloneLoading || anyRunning || !cloneFile || !cloneName.trim())}
                          onClick={uploadVoiceClone}
                          disabled={cloneLoading || anyRunning || !cloneFile || !cloneName.trim()}
                        >
                          {cloneLoading ? '创建中…' : '创建并使用'}
                        </button>
                      </div>
                      <p style={hintStyle}>支持 mp3、wav、m4a；小于 50MB；建议 2-60 秒参考音频。</p>
                    </Panel>

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
                    <SceneAssetsPanel
                      sceneId={selectedScene.id}
                      assets={selectedConfigScene?.assets ?? []}
                      assetFile={assetFile}
                      assetRole={assetRole}
                      assetNotes={assetNotes}
                      loading={assetLoading}
                      disabled={anyRunning}
                      onFileChange={setAssetFile}
                      onRoleChange={setAssetRole}
                      onNotesChange={setAssetNotes}
                      onUpload={() => uploadSceneAsset(selectedScene.id)}
                      onDelete={(assetId) => deleteSceneAsset(selectedScene.id, assetId)}
                    />

                    <Panel title="视觉设计方案" subtitle={selectedConfigScene?.designNotes ? '可编辑' : '未生成'}>
                      <textarea
                        value={selectedConfigScene?.designNotes ?? ''}
                        onChange={(e) => updateSceneDesign(selectedScene.id, e.target.value)}
                        placeholder="点击「重新生成设计方案」自动生成，或在这里直接编辑画面设计、节奏、字幕位置和素材使用要求。"
                        disabled={anyRunning}
                        style={{...textareaStyle, minHeight: 280, fontFamily: 'Consolas, monospace'}}
                        rows={12}
                      />
                      <p style={hintStyle}>编辑后点击左上角「保存脚本」写入配置；生成 Remotion 代码前也会自动保存当前内容。</p>
                      <div style={{display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap'}}>
                        <button
                          type="button"
                          style={buttonStyle('#bd93f9', anyRunning)}
                          onClick={() =>
                            setModal({kind: 'design', sceneId: selectedScene.id, prompt: '', loading: false})
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
                            <div style={{...logBoxStyle, maxHeight: 320}}>
                              {codegen.logs.slice(-80).map((line, i) => (
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
                        <div style={emptyStyle}>通过对话描述预览问题，OpenAI Agent 会结合时间轴重新生成 Remotion 代码。</div>
                      )}
                      <button
                        type="button"
                        style={{...buttonStyle('#8be9fd', anyRunning), marginTop: 12}}
                        onClick={() => setTuneDialogOpen(true)}
                        disabled={anyRunning}
                      >
                        打开微调对话
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

      <TuneCodegenDialog
        open={Boolean(tuneDialogOpen && selectedScene)}
        sceneId={selectedScene?.id ?? ''}
        sceneText={selectedConfigScene?.text ?? selectedScene?.text ?? ''}
        disabled={anyRunning}
        onClose={() => setTuneDialogOpen(false)}
        onDone={async (payload) => {
          if (payload?.config) setConfig(payload.config as Config);
          const status = await fetchJson<CodegenStatus>('/api/scene/codegen/status');
          setCodegen(status);
          await refresh();
          setCacheKey(Date.now());
          pushLog(`${selectedScene?.id ?? '当前场景'} 已根据微调对话重新生成 Remotion 代码`);
        }}
      />

      {modal?.kind === 'design' ? (
        <DesignDialog
          modal={{...modal, result: modal.result ?? modalConfigScene?.designNotes ?? ''}}
          assets={modalConfigScene?.assets ?? []}
          assetFile={assetFile}
          assetRole={assetRole}
          assetNotes={assetNotes}
          assetLoading={assetLoading}
          onClose={() => setModal(null)}
          onModalChange={(nextModal) => setModal(nextModal)}
          onAssetFileChange={setAssetFile}
          onAssetRoleChange={setAssetRole}
          onAssetNotesChange={setAssetNotes}
          onRequestDesign={requestDesign}
        />
      ) : null}
    </Shell>
    </ErrorBoundary>
  );
}

/* ---------- styles ---------- */

const layoutStyle: React.CSSProperties = {height: '100%', display: 'grid', gridTemplateColumns: 'minmax(560px, 1fr) 46%', gap: 0};
const leftStyle: React.CSSProperties = {padding: 20, overflow: 'auto', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column'};
const rightStyle: React.CSSProperties = {display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: '#080c18'};
const rightHeaderStyle: React.CSSProperties = {padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)'};
const headerStyle: React.CSSProperties = {display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 14};
const titleStyle: React.CSSProperties = {margin: 0, fontSize: 22};
const subStyle: React.CSSProperties = {margin: '6px 0 0', color: '#9fb3c8', fontSize: 13};
const modelInputStyle: React.CSSProperties = {width: 150, borderRadius: 10, border: '1px solid rgba(139,233,253,0.25)', background: '#070b16', color: '#e6edf3', padding: '9px 10px', fontSize: 13, fontWeight: 700};
const voiceCloneGridStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: '1.1fr 0.7fr 0.9fr auto', gap: 8, alignItems: 'center'};
const smallInputStyle: React.CSSProperties = {minWidth: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: '#070b16', color: '#e6edf3', padding: '9px 10px', fontSize: 13};
const fileInputStyle: React.CSSProperties = {minWidth: 0, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: '#070b16', color: '#e6edf3', padding: '7px 10px', fontSize: 13};
const textareaStyle: React.CSSProperties = {width: '100%', boxSizing: 'border-box', resize: 'vertical', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: '#070b16', color: '#e6edf3', padding: 10, lineHeight: 1.5, fontSize: 14};
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
const markdownPreviewStyle: React.CSSProperties = {whiteSpace: 'pre-wrap', background: '#05070d', borderRadius: 12, padding: 12, color: '#c8dcff', fontSize: 13, lineHeight: 1.7};
const fieldLabelStyle: React.CSSProperties = {display: 'grid', gap: 6, fontSize: 12, color: '#9fb3c8', fontWeight: 700};
const llmConfigGridStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: '1fr 1fr 180px', gap: 10, alignItems: 'end'};

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
