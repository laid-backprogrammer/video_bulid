import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {PreviewDeck} from './components/PreviewDeck';
import {SceneAssetsDrawer} from './components/SceneAssetsDrawer';
import {SceneWorkflowStrip} from './components/SceneWorkflowStrip';
import {fetchJson, postJson, postSse} from './api';
import {STUDIO_GOAL, getRunStateText} from './state';
import type {
  AgentAction,
  AgentAssetIntent,
  AgentAttachmentDraft,
  AgentMessage,
  AgentMode,
  AgentStageId,
  AgentStageStep,
  AgentStageStatus,
  CodegenStatus,
  Config,
  PipelineStatus,
  RenderStatus,
  SceneItem,
  TtsStatus,
} from './types';

type DrawerKind = 'progress' | 'preview' | 'assets' | 'logs' | null;
type BackgroundJob = {sceneId: string; phase: string};

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MEDIA_ACCEPT = 'image/*,video/*,audio/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.png,.jpg,.jpeg,.gif';
const ACTIVE_MODES: AgentMode[] = ['review', 'advice'];

const MODE_META: Record<AgentMode, {label: string; desc: string}> = {
  review: {label: '分段协作', desc: '一段一段结对确认；敲定后后台生成，你继续聊下一段。'},
  auto: {label: '自动模式', desc: '稍后开放；当前先聚焦分段协作。'},
  advice: {label: '建议模式', desc: '只讨论方案，不写配置，不调用生成或渲染。'},
};

const DEFAULT_STAGES: AgentStageStep[] = [
  {id: 'understanding', label: '理解目标', status: 'pending', detail: '等待用户输入内容、方向和素材。'},
  {id: 'script', label: '脚本分镜', status: 'pending', detail: '拆解文章并形成短视频结构。'},
  {id: 'assets', label: '素材意图', status: 'pending', detail: '判断图片、视频、BGM 和音效的用途。'},
  {id: 'tts', label: 'TTS 配音', status: 'pending', detail: '生成每段语音。'},
  {id: 'asr', label: 'ASR 对齐', status: 'pending', detail: '生成 cues 和 words 时间轴。'},
  {id: 'design', label: '视觉方案', status: 'pending', detail: '生成每段画面设计和素材使用规则。'},
  {id: 'codegen', label: 'Remotion 生成', status: 'pending', detail: '生成并校验场景 TSX。'},
  {id: 'render', label: '预览渲染', status: 'pending', detail: '预检并渲染预览稿。'},
  {id: 'review', label: '验收反馈', status: 'pending', detail: '等待用户查看效果并给意见。'},
];

const cloneStages = () => DEFAULT_STAGES.map((item) => ({...item}));
const shortName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 28) || 'asset';
const uniqueAlias = (base: string, taken: Set<string>) => {
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  taken.add(candidate);
  return candidate;
};

const inferAttachmentKind = (file: File): AgentAttachmentDraft['kind'] => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (/\.(png|jpe?g|gif|webp)$/i.test(file.name)) return 'image';
  if (/\.(mp4|mov|webm|m4v)$/i.test(file.name)) return 'video';
  if (/\.(mp3|wav|m4a|aac)$/i.test(file.name)) return 'audio';
  return 'unknown';
};

const inferAttachmentIntent = (file: File): AgentAssetIntent => {
  const text = file.name.toLowerCase();
  const kind = inferAttachmentKind(file);
  if (kind === 'image') {
    return /style|ref|reference|mood|风格|参考/.test(text) ? 'style_reference' : 'visual_asset';
  }
  if (kind === 'video') {
    return /bg|background|背景/.test(text) ? 'background_video' : 'insert_video';
  }
  if (kind === 'audio') {
    if (/bgm|music|背景|配乐/.test(text)) return 'bgm';
    if (/voice|clone|reference|人声|配音|音色/.test(text)) return 'voice_reference';
    return 'sound_effect';
  }
  return 'unknown';
};

const intentLabel: Record<AgentAssetIntent, string> = {
  visual_asset: '画面素材',
  style_reference: '风格参考',
  insert_video: '插入视频',
  background_video: '背景视频',
  bgm: 'BGM',
  sound_effect: '音效',
  voice_reference: '声音参考',
  unknown: '待判断',
};

const stageColor: Record<AgentStageStatus, string> = {
  pending: '#627086',
  running: '#4cc9f0',
  paused: '#ffb703',
  done: '#2ec4b6',
  failed: '#ff6b6b',
};

export default function AgentStudioApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [render, setRender] = useState<RenderStatus | null>(null);
  const [tts, setTts] = useState<TtsStatus | null>(null);
  const [codegen, setCodegen] = useState<CodegenStatus | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [cacheKey, setCacheKey] = useState(Date.now());
  const [mode, setMode] = useState<AgentMode>('review');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'system-welcome',
      role: 'system',
      content: '先选当前段，把文章、修改意见、图片、视频、BGM 或音效丢给我。素材会隔离在当前段，使用时可以输入 @alias；本段敲定后我会后台生成，你继续推进下一段。',
    },
  ]);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [actionRunning, setActionRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AgentAttachmentDraft[]>([]);
  const [stages, setStages] = useState<AgentStageStep[]>(cloneStages);
  const [scriptDraft, setScriptDraft] = useState('');
  const [scriptEditOpen, setScriptEditOpen] = useState(false);
  const [backgroundJob, setBackgroundJob] = useState<BackgroundJob | null>(null);

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedId) ?? scenes[0] ?? null,
    [scenes, selectedId],
  );
  const fps = config?.fps ?? 30;
  const selectedSceneDrafts = useMemo(
    () => attachments.filter((item) => item.sceneId === selectedScene?.id),
    [attachments, selectedScene?.id],
  );
  const pendingAssetCounts = useMemo(() => attachments.reduce<Record<string, number>>((counts, item) => {
    counts[item.sceneId] = (counts[item.sceneId] ?? 0) + 1;
    return counts;
  }, {}), [attachments]);
  const backendRunning = Boolean(tts?.running || codegen?.running || render?.running || pipeline?.running);
  const generationBusy = Boolean(actionRunning || backgroundJob || backendRunning);
  const chatBusy = agentRunning;
  const runState = backgroundJob ? `${backgroundJob.sceneId} · ${backgroundJob.phase}` : getRunStateText(tts, codegen, render, pipeline);

  useEffect(() => {
    setScriptDraft(selectedScene?.text ?? '');
  }, [selectedScene?.id, selectedScene?.text]);

  const pushLog = useCallback((line: string) => {
    setLogs((current) => [...current.slice(-180), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const setStage = useCallback((id: AgentStageId, status: AgentStageStatus, detail: string) => {
    setStages((current) => current.map((stage) => (
      stage.id === id ? {...stage, status, detail} : stage
    )));
  }, []);

  const refresh = useCallback(async () => {
    const [cfg, sceneStatus, renderStatus, ttsStatus, codegenStatus, pipelineStatus] = await Promise.all([
      fetchJson<Config>('/api/config'),
      fetchJson<{fps: number; scenes: SceneItem[]}>('/api/scenes'),
      fetchJson<RenderStatus>('/api/render/status'),
      fetchJson<TtsStatus>('/api/tts/status'),
      fetchJson<CodegenStatus>('/api/scene/codegen/status'),
      fetchJson<PipelineStatus>('/api/pipeline/status'),
    ]);
    setConfig(cfg);
    setScenes(sceneStatus.scenes);
    setRender(renderStatus);
    setTts(ttsStatus);
    setCodegen(codegenStatus);
    setPipeline(pipelineStatus);
    if (!selectedId && sceneStatus.scenes[0]) setSelectedId(sceneStatus.scenes[0].id);
  }, [selectedId]);

  useEffect(() => {
    refresh().catch((error) => pushLog(`加载工作台失败：${error.message || error}`));
  }, [pushLog, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const addAttachments = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []);
    if (!nextFiles.length) return;
    const sceneId = selectedScene?.id ?? selectedId ?? scenes[0]?.id;
    if (!sceneId) {
      setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: '请先选择一个场景，再添加素材。'}]);
      return;
    }
    const existingScene = scenes.find((scene) => scene.id === sceneId);
    const storedAliases = (existingScene?.assets ?? [])
      .flatMap((asset) => [asset.alias, asset.id])
      .filter((value): value is string => Boolean(value));
    setAttachments((current) => {
      const taken = new Set([
        ...current.filter((item) => item.sceneId === sceneId).map((item) => item.alias),
        ...storedAliases,
      ]);
      const drafts = nextFiles.map((file) => {
        const kind = inferAttachmentKind(file);
        const inferredIntent = inferAttachmentIntent(file);
        const alias = uniqueAlias(shortName(file.name), taken);
        return {
          id: makeId('asset'),
          sceneId,
          file,
          fileName: file.name,
          alias,
          mimeType: file.type,
          size: file.size,
          kind,
          inferredIntent,
          notes: `${intentLabel[inferredIntent]}：${file.name}`,
        };
      });
      return [...current, ...drafts];
    });
    pushLog(`${sceneId} 新增 ${nextFiles.length} 个待确认素材`);
    setDrawer('assets');
  };

  const updateAttachmentIntent = (id: string, inferredIntent: AgentAssetIntent) => {
    setAttachments((current) => current.map((item) => (
      item.id === id ? {...item, inferredIntent, notes: item.notes || `${intentLabel[inferredIntent]}：${item.fileName}`} : item
    )));
  };

  const updateAttachmentNotes = (id: string, notes: string) => {
    setAttachments((current) => current.map((item) => (item.id === id ? {...item, notes} : item)));
  };

  const uploadAttachments = useCallback(async (sceneId: string) => {
    const sceneDrafts = attachments.filter((item) => item.sceneId === sceneId);
    if (!sceneDrafts.length || mode === 'advice') return [];
    const uploadedSummaries: AgentAttachmentDraft[] = [];
    for (const item of sceneDrafts) {
      const form = new FormData();
      form.append('sceneId', sceneId);
      form.append('assetType', item.kind === 'unknown' ? 'image' : item.kind);
      form.append('role', item.inferredIntent === 'style_reference' ? 'reference' : 'render');
      form.append('alias', item.alias);
      form.append('notes', `${intentLabel[item.inferredIntent]}。${item.notes}`.trim());
      form.append('file', item.file);
      await fetchJson('/api/scene/assets', {method: 'POST', body: form});
      uploadedSummaries.push(item);
      pushLog(`素材已写入 ${sceneId}：@${item.alias} · ${item.fileName} · ${intentLabel[item.inferredIntent]}`);
    }
    setStage('assets', 'done', `已处理 ${uploadedSummaries.length} 个素材意图。`);
    setAttachments((current) => current.filter((item) => item.sceneId !== sceneId));
    await refresh();
    return uploadedSummaries;
  }, [attachments, mode, pushLog, refresh, setStage]);

  const appendMention = useCallback((mention: string) => {
    setInput((current) => {
      const spacer = current && !/\s$/.test(current) ? ' ' : '';
      return `${current}${spacer}${mention} `;
    });
  }, []);

  const recentConversationText = useCallback(() => messages.slice(-8).map((message) => {
    const role = message.role === 'user' ? '用户' : message.role === 'agent' ? 'Agent' : '系统';
    return `${role}: ${message.content}`;
  }).join('\n'), [messages]);

  const buildSceneCommitPrompt = useCallback((sceneId: string, text: string) => {
    const scene = scenes.find((item) => item.id === sceneId);
    const assets = (scene?.assets ?? []).map((asset) => `@${asset.alias || asset.id} ${asset.assetType || ''} ${asset.role || ''} ${asset.notes || asset.name}`).join('\n');
    const pending = attachments.filter((item) => item.sceneId === sceneId).map((item) => `@${item.alias} ${intentLabel[item.inferredIntent]} ${item.notes}`).join('\n');
    return [
      `当前阶段：${sceneId} 已由用户敲定，开始生成本段预览。`,
      '素材隔离：只处理当前 scene 的素材；其他 scene 的素材不要引用。',
      '素材规则：只有最近对话或本 prompt 中被 @alias 明确提及的素材可以进入视觉方案和代码生成。',
      `本段文案：${text}`,
      '',
      `最近对话：\n${recentConversationText() || '(empty)'}`,
      '',
      `本段已入库素材：\n${assets || '(none)'}`,
      '',
      `本段待入库素材：\n${pending || '(none)'}`,
    ].join('\n');
  }, [attachments, recentConversationText, scenes]);

  const persistSceneText = useCallback(async (sceneId: string, text: string) => {
    const latestConfig = await fetchJson<Config>('/api/config');
    const nextConfig = {
      ...latestConfig,
      scenes: latestConfig.scenes.map((scene) => (
        scene.id === sceneId ? {...scene, text} : scene
      )),
    };
    await postJson('/api/config', nextConfig);
    setConfig(nextConfig);
    return nextConfig;
  }, []);

  const updateAgentMessage = useCallback((id: string, content: string) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? {...message, content} : message
    )));
  }, []);

  const waitForCodegen = useCallback(async (sceneId: string) => {
    for (let attempt = 0; attempt < 180; attempt++) {
      const status = await fetchJson<CodegenStatus>('/api/scene/codegen/status');
      setCodegen(status);
      if (!status.running && status.sceneId === sceneId) {
        if (status.error) throw new Error(status.error);
        return status;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new Error('代码生成等待超时');
  }, []);

  const waitForRender = useCallback(async () => {
    for (let attempt = 0; attempt < 240; attempt++) {
      const status = await fetchJson<RenderStatus>('/api/render/status');
      setRender(status);
      if (!status.running) {
        if (status.error) throw new Error(status.error);
        return status;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error('渲染等待超时');
  }, []);

  const askAgent = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || agentRunning) return;
    const sceneId = selectedScene?.id ?? selectedId;
    const sceneDrafts = attachments.filter((item) => item.sceneId === sceneId);
    const attachmentMeta = sceneDrafts.map((item) => ({
      sceneId: item.sceneId,
      fileName: item.fileName,
      alias: item.alias,
      mimeType: item.mimeType,
      kind: item.kind,
      inferredIntent: item.inferredIntent,
      notes: item.notes,
    }));
    const savedAssetMeta = (selectedScene?.assets ?? []).map((asset) => ({
      id: asset.id,
      alias: asset.alias,
      name: asset.name,
      assetType: asset.assetType,
      role: asset.role,
      notes: asset.notes,
    }));
    const user = {
      id: makeId('user'),
      role: 'user' as const,
      content: [
        sceneId ? `[当前段 ${sceneId}]\n` : '',
        userMessage.trim(),
        attachmentMeta.length ? `\n[本段待入库素材]\n${attachmentMeta.map((item) => `- @${item.alias} ${item.fileName}: ${intentLabel[item.inferredIntent]} ${item.notes}`).join('\n')}` : '',
      ].join(''),
    };
    const agentId = makeId('agent');
    const history = [...messages, user].slice(-10).map((message) => ({role: message.role, content: message.content}));

    setMessages((current) => [...current, user, {id: agentId, role: 'agent', content: ''}]);
    setAgentActions([]);
    setAgentRunning(true);
    setStages(cloneStages());
    setStage('understanding', 'running', 'Agent 正在理解目标、文章和素材意图。');
    pushLog(`Agent 开始分析：${MODE_META[mode].label}`);

    try {
      await postSse('/api/agent/plan/stream', {
        goal: STUDIO_GOAL,
        mode,
        sceneId,
        userMessage: userMessage.trim(),
        attachments: attachmentMeta,
        availableAssets: savedAssetMeta,
        history,
      }, {
        status: (payload) => {
          if (payload.message) pushLog(payload.message);
        },
        token: (payload) => {
          updateAgentMessage(agentId, payload.text ?? '');
        },
        actions: (payload) => {
          setAgentActions(Array.isArray(payload.actions) ? payload.actions : []);
        },
        done: async (payload) => {
          updateAgentMessage(agentId, payload.text ?? '');
          setStage('understanding', 'done', 'Agent 已完成目标理解。');
          if (mode === 'advice') {
            setStage('script', 'paused', '建议模式只输出方案，不执行制作流水线。');
          } else if (mode === 'review') {
            setStage('script', 'paused', '分段协作：继续对齐本段意见，敲定后后台生成。');
          }
          pushLog('Agent 回复完成');
        },
        error: (payload) => {
          updateAgentMessage(agentId, `计划生成失败：${payload.error || 'unknown error'}`);
          setStage('understanding', 'failed', payload.error || 'Agent 计划失败');
          pushLog(`Agent 计划失败：${payload.error || 'unknown error'}`);
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAgentMessage(agentId, `执行失败：${message}`);
      setStage('understanding', 'failed', message);
      pushLog(`Agent 执行失败：${message}`);
    } finally {
      setAgentRunning(false);
    }
  }, [agentRunning, attachments, messages, mode, pushLog, selectedId, selectedScene?.assets, selectedScene?.id, setStage, updateAgentMessage]);

  const runAction = useCallback(async (action: AgentAction) => {
    if (generationBusy || mode === 'advice') return;
    setActionRunning(action.id);
    setDrawer('progress');
    pushLog(`确认执行：${action.label}`);
    try {
      const sceneId = action.sceneId ?? selectedScene?.id ?? selectedId;
      switch (action.type) {
        case 'run_tts_scene':
          if (!sceneId) throw new Error('缺少 sceneId');
          setStage('tts', 'running', `正在为 ${sceneId} 生成语音。`);
          await postJson('/api/tts', {sceneId, force: Boolean(action.payload?.force)});
          setStage('tts', 'done', '语音已生成。');
          break;
        case 'run_asr_scene':
          if (!sceneId) throw new Error('缺少 sceneId');
          setStage('asr', 'running', `正在为 ${sceneId} 对齐字幕。`);
          await postJson('/api/asr', {sceneId, force: Boolean(action.payload?.force)});
          setStage('asr', 'done', '字幕时间轴已生成。');
          break;
        case 'generate_design_scene':
          if (!config || !sceneId) throw new Error('配置或 sceneId 尚未加载');
          setStage('design', 'running', '正在生成视觉方案。');
          {
            const scene = scenes.find((item) => item.id === sceneId);
            const configScene = config.scenes.find((item) => item.id === sceneId);
            if (!scene || !configScene) throw new Error(`找不到场景：${sceneId}`);
            const result = await postJson<{design: string; provider: string}>('/api/scene/design', {
              sceneId,
              text: configScene.text,
              durationMs: scene.durationMs,
              prompt: String(action.payload?.prompt ?? '请生成适合当前文案和时间轴的可执行视觉方案。'),
              currentDesignNotes: configScene.designNotes ?? '',
            });
            const nextConfig = {...config, scenes: config.scenes.map((item) => item.id === sceneId ? {...item, designNotes: result.design} : item)};
            await postJson('/api/config', nextConfig);
            setConfig(nextConfig);
          }
          setStage('design', 'done', '视觉方案已生成。');
          break;
        case 'generate_code_scene':
          if (!sceneId) throw new Error('缺少 sceneId');
          setStage('codegen', 'running', '正在生成 Remotion 代码。');
          if (config) await postJson('/api/config', config);
          await postJson('/api/scene/codegen', {sceneId, provider: 'openai', repairs: 2, check: true});
          await waitForCodegen(sceneId);
          setStage('codegen', 'done', 'Remotion 代码已生成。');
          break;
        case 'render_preview_scene':
          if (!sceneId) throw new Error('缺少 sceneId');
          setStage('render', 'running', '正在渲染预览。');
          await postJson('/api/render', {sceneId});
          await waitForRender();
          setStage('render', 'done', '预览已渲染。');
          setStage('review', 'paused', '请验收预览效果。');
          setDrawer('preview');
          break;
        case 'rebuild_manifest':
          await postJson('/api/manifest/rebuild', {});
          break;
        case 'render_full_video':
          setStage('render', 'running', '正在渲染完整视频。');
          await postJson('/api/render', {});
          await waitForRender();
          setStage('render', 'done', '完整视频已渲染。');
          setDrawer('preview');
          break;
        case 'save_config':
          if (!config) throw new Error('配置尚未加载');
          await postJson('/api/config', config);
          break;
        default:
          throw new Error(`未知动作：${action.type}`);
      }
      await refresh();
      setCacheKey(Date.now());
      pushLog(`完成：${action.label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStage('review', 'failed', message);
      pushLog(`${action.label} 失败：${message}`);
      setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: `${action.label} 失败：${message}`}]);
    } finally {
      setActionRunning(null);
    }
  }, [config, generationBusy, mode, pushLog, refresh, scenes, selectedId, selectedScene?.id, setStage, waitForCodegen, waitForRender]);

  const submit = () => {
    const text = input.trim();
    if (!text || chatBusy) return;
    setInput('');
    askAgent(text);
  };

  const acceptPreview = () => {
    setStage('review', 'done', '用户已通过当前预览。');
    setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: '当前预览已通过。你可以继续让我导出完整视频，或继续输入修改意见。'}]);
  };

  const regeneratePreview = () => {
    const action = agentActions.find((item) => item.type === 'render_preview_scene')
      ?? (selectedScene ? {
        id: `${selectedScene.id}-rerender`,
        type: 'render_preview_scene' as const,
        sceneId: selectedScene.id,
        label: '重新渲染预览',
        description: '重新渲染当前场景预览。',
        tone: 'primary' as const,
      } : null);
    if (action) runAction(action);
  };

  const saveScriptDraft = useCallback(async ({regenerate = false} = {}) => {
    if (!config || !selectedScene || generationBusy) return;
    const nextText = scriptDraft.trim();
    if (!nextText) {
      setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: '文案不能为空。'}]);
      return;
    }

    const sceneId = selectedScene.id;
    setActionRunning(regenerate ? 'script-regenerate' : 'script-save');
    setDrawer(regenerate ? 'progress' : 'preview');
    try {
      setStage('script', 'running', `正在保存 ${sceneId} 的新文案。`);
      const latestConfig = await persistSceneText(sceneId, nextText);
      setStage('script', 'done', `${sceneId} 文案已保存。`);
      pushLog(`${sceneId} 文案已保存`);

      if (!regenerate) {
        await refresh();
        setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: `${sceneId} 文案已保存。需要重做配音时点击“保存并重做语音+预览”。`}]);
        return;
      }

      setStage('tts', 'running', '文案已变化，正在强制重新生成语音。');
      await postJson('/api/tts', {sceneId, force: true});
      setStage('tts', 'done', '新语音已生成。');

      setStage('asr', 'running', '正在基于新语音重新对齐字幕时间轴。');
      await postJson('/api/asr', {sceneId, force: true});
      setStage('asr', 'done', '新字幕时间轴已生成。');

      setStage('design', 'running', '正在根据新文案刷新视觉方案。');
      const design = await postJson<{design: string; provider: string}>('/api/scene/design', {
        sceneId,
        text: nextText,
        durationMs: selectedScene.durationMs,
        prompt: '文案已修改，请基于新文案、新语音节奏和现有素材意图刷新视觉方案，避免沿用与新文案冲突的旧节奏。',
        currentDesignNotes: latestConfig.scenes.find((scene) => scene.id === sceneId)?.designNotes ?? '',
      });
      const configAfterDesign = await fetchJson<Config>('/api/config');
      const nextConfigAfterDesign = {
        ...configAfterDesign,
        scenes: configAfterDesign.scenes.map((scene) => (
          scene.id === sceneId ? {...scene, text: nextText, designNotes: design.design} : scene
        )),
      };
      await postJson('/api/config', nextConfigAfterDesign);
      setConfig(nextConfigAfterDesign);
      setStage('design', 'done', '视觉方案已根据新文案刷新。');

      setStage('codegen', 'running', '正在基于新文案和时间轴重新生成 Remotion 代码。');
      await postJson('/api/scene/codegen', {sceneId, provider: 'openai', repairs: 2, check: true});
      await waitForCodegen(sceneId);
      setStage('codegen', 'done', 'Remotion 代码已重新生成。');

      setStage('render', 'running', '正在渲染修改后的预览。');
      await postJson('/api/render', {sceneId});
      await waitForRender();
      await refresh();
      setCacheKey(Date.now());
      setStage('render', 'done', '修改后的预览已渲染完成。');
      setStage('review', 'paused', '请验收修改后的预览效果。');
      setScriptEditOpen(false);
      setDrawer('preview');
      setMessages((current) => [...current, {
        id: makeId('system'),
        role: 'system',
        content: `${sceneId} 已按新文案重新生成语音、字幕、画面代码并完成预览渲染。`,
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStage('review', 'failed', message);
      setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: `文案修改流程失败：${message}`}]);
      pushLog(`文案修改流程失败：${message}`);
    } finally {
      setActionRunning(null);
    }
  }, [config, generationBusy, persistSceneText, pushLog, refresh, scriptDraft, selectedScene, setStage, waitForCodegen, waitForRender]);

  const startSceneBackgroundGenerate = useCallback((sceneId: string, text: string) => {
    if (generationBusy || mode === 'advice') return false;
    const nextText = text.trim();
    const sourceScene = scenes.find((scene) => scene.id === sceneId);
    if (!sourceScene || !nextText) {
      setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: '当前段缺少文案，先补齐文案再生成。'}]);
      return false;
    }

    const textChanged = sourceScene.text.trim() !== nextText;
    const designPrompt = buildSceneCommitPrompt(sceneId, nextText);

    const run = async () => {
      setBackgroundJob({sceneId, phase: '保存文案'});
      setStages(cloneStages());
      setDrawer('progress');
      try {
        setStage('script', 'running', `正在保存 ${sceneId} 的最终文案。`);
        let latestConfig = await persistSceneText(sceneId, nextText);
        setStage('script', 'done', `${sceneId} 文案已敲定。`);

        setBackgroundJob({sceneId, phase: '写入素材'});
        setStage('assets', 'running', `正在写入 ${sceneId} 的本段素材。`);
        await uploadAttachments(sceneId);
        setStage('assets', 'done', `${sceneId} 素材上下文已隔离。`);

        const needTts = textChanged || !sourceScene.audioExists;
        if (needTts) {
          setBackgroundJob({sceneId, phase: '生成语音'});
          setStage('tts', 'running', `正在为 ${sceneId} 生成语音。`);
          await postJson('/api/tts', {sceneId, force: textChanged});
          setStage('tts', 'done', '语音已生成。');
        } else {
          setStage('tts', 'done', '沿用已有语音。');
        }

        let latestScene = (await fetchJson<{fps: number; scenes: SceneItem[]}>('/api/scenes')).scenes.find((scene) => scene.id === sceneId) ?? sourceScene;
        const needAsr = needTts || !latestScene.captionExists;
        if (needAsr) {
          setBackgroundJob({sceneId, phase: '对齐字幕'});
          setStage('asr', 'running', `正在对齐 ${sceneId} 字幕时间轴。`);
          await postJson('/api/asr', {sceneId, force: needTts});
          setStage('asr', 'done', '字幕时间轴已生成。');
        } else {
          setStage('asr', 'done', '沿用已有字幕时间轴。');
        }

        latestScene = (await fetchJson<{fps: number; scenes: SceneItem[]}>('/api/scenes')).scenes.find((scene) => scene.id === sceneId) ?? latestScene;
        latestConfig = await fetchJson<Config>('/api/config');
        const configScene = latestConfig.scenes.find((scene) => scene.id === sceneId);
        if (!configScene) throw new Error(`找不到场景：${sceneId}`);

        setBackgroundJob({sceneId, phase: '生成视觉方案'});
        setStage('design', 'running', `正在根据对话和 @ 素材生成 ${sceneId} 视觉方案。`);
        const design = await postJson<{design: string; provider: string}>('/api/scene/design', {
          sceneId,
          text: configScene.text,
          durationMs: latestScene.durationMs,
          prompt: designPrompt,
          currentDesignNotes: configScene.designNotes ?? '',
        });
        const configAfterDesign = await fetchJson<Config>('/api/config');
        const nextConfigAfterDesign = {
          ...configAfterDesign,
          scenes: configAfterDesign.scenes.map((scene) => (
            scene.id === sceneId ? {...scene, text: nextText, designNotes: design.design} : scene
          )),
        };
        await postJson('/api/config', nextConfigAfterDesign);
        setConfig(nextConfigAfterDesign);
        setStage('design', 'done', '视觉方案已保存。');

        setBackgroundJob({sceneId, phase: '生成代码'});
        setStage('codegen', 'running', `正在生成并校验 ${sceneId} Remotion 代码。`);
        await postJson('/api/scene/codegen', {sceneId, provider: 'openai', repairs: 2, check: true});
        await waitForCodegen(sceneId);
        setStage('codegen', 'done', 'Remotion 代码已生成。');

        setBackgroundJob({sceneId, phase: '渲染预览'});
        setStage('render', 'running', `正在渲染 ${sceneId} 单段预览。`);
        await postJson('/api/render', {sceneId});
        await waitForRender();
        await refresh();
        setCacheKey(Date.now());
        setStage('render', 'done', '单段预览已完成。');
        setStage('review', 'paused', `${sceneId} 已完成预览，稍后可打开预览抽屉验收。`);
        setMessages((current) => [...current, {
          id: makeId('system'),
          role: 'system',
          content: `${sceneId} 后台生成完成。你可以打开预览抽屉验收，当前对话可以继续推进下一段。`,
        }]);
        pushLog(`${sceneId} 后台生成完成`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStage('review', 'failed', message);
        setMessages((current) => [...current, {id: makeId('system'), role: 'system', content: `${sceneId} 后台生成失败：${message}`}]);
        pushLog(`${sceneId} 后台生成失败：${message}`);
      } finally {
        setBackgroundJob(null);
      }
    };

    void run();
    return true;
  }, [buildSceneCommitPrompt, generationBusy, mode, persistSceneText, pushLog, refresh, scenes, setStage, uploadAttachments, waitForCodegen, waitForRender]);

  const commitSelectedScene = useCallback(() => {
    if (!selectedScene) return;
    const sceneId = selectedScene.id;
    const text = scriptDraft.trim() || selectedScene.text.trim();
    const started = startSceneBackgroundGenerate(sceneId, text);
    if (!started) return;
    const currentIndex = scenes.findIndex((scene) => scene.id === sceneId);
    const nextScene = scenes.slice(currentIndex + 1).find((scene) => scene.enabled !== false) ?? null;
    if (nextScene) {
      setSelectedId(nextScene.id);
      setMessages((current) => [...current, {
        id: makeId('system'),
        role: 'system',
        content: `${sceneId} 已进入后台生成。我们先切到 ${nextScene.id}，可以继续整理下一段。`,
      }]);
    }
  }, [scenes, scriptDraft, selectedScene, startSceneBackgroundGenerate]);

  return (
    <div style={shellStyle}>
      <div style={topBarStyle}>
        <strong>Agent Studio</strong>
        <span>{MODE_META[mode].label} · {runState}</span>
      </div>

      <main style={chatStageStyle}>
        <SceneWorkflowStrip
          scenes={scenes}
          selectedId={selectedScene?.id ?? selectedId}
          tts={tts}
          codegen={codegen}
          render={render}
          pipeline={pipeline}
          activeGenerationSceneId={backgroundJob?.sceneId ?? null}
          pendingAssetCounts={pendingAssetCounts}
          generationDisabled={generationBusy || mode === 'advice'}
          onSelect={setSelectedId}
          onCommitSelected={commitSelectedScene}
        />

        <section style={threadStyle}>
          {messages.map((message) => (
            <article key={message.id} style={messageStyle(message.role)}>
              <div style={messageLabelStyle}>{message.role === 'user' ? '你' : message.role === 'agent' ? 'Agent' : '系统'}</div>
              <div style={bubbleStyle(message.role)}>{message.content || (agentRunning ? '正在理解你的需求...' : '')}</div>
            </article>
          ))}
          {agentRunning ? <div style={thinkingStyle}>Agent 正在分析上下文、素材意图和制作路径...</div> : null}
        </section>

        {mode === 'review' && agentActions.length ? (
          <section style={reviewCardStyle}>
            <div>
              <strong>分段协作</strong>
              <p>Agent 已给出当前段可执行动作。手动动作会占用生成通道，敲定后也可让本段后台跑完。</p>
            </div>
            <div style={actionPillRowStyle}>
              {agentActions.map((action) => (
                <button key={action.id} type="button" style={smallActionStyle(actionRunning === action.id)} disabled={generationBusy} onClick={() => runAction(action)}>
                  {actionRunning === action.id ? '执行中' : action.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section style={drawerButtonRowStyle}>
          {[
            ['progress', '进度'],
            ['preview', '预览'],
            ['assets', `素材${selectedSceneDrafts.length ? ` ${selectedSceneDrafts.length}` : ''}`],
            ['logs', '日志'],
          ].map(([key, label]) => (
            <button key={key} type="button" style={drawerButtonStyle(drawer === key)} onClick={() => setDrawer(drawer === key ? null : key as DrawerKind)}>
              {label}
            </button>
          ))}
        </section>

        <section style={composerShellStyle}>
          <div style={modeRowStyle}>
            {ACTIVE_MODES.map((item) => (
              <button
                key={item}
                type="button"
                style={modeButtonStyle(mode === item)}
                disabled={generationBusy}
                onClick={() => setMode(item)}
              >
                {MODE_META[item].label}
              </button>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`${selectedScene?.id ?? '当前段'}：写修改意见、素材用途，或用 @alias 指定素材。`}
            style={inputStyle}
            disabled={chatBusy}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
            }}
          />
          <div style={composerFooterStyle}>
            <label style={fileButtonStyle}>
              +
              <input type="file" multiple accept={MEDIA_ACCEPT} style={{display: 'none'}} onChange={(event) => addAttachments(event.target.files)} />
            </label>
            <span style={modeHintStyle}>{MODE_META[mode].desc}</span>
            <button type="button" style={sendButtonStyle(!input.trim() || chatBusy)} disabled={!input.trim() || chatBusy} onClick={submit}>
              {chatBusy ? '分析中' : '发送'}
            </button>
          </div>
        </section>
      </main>

      {drawer ? (
        <aside style={drawerStyle}>
          <header style={drawerHeaderStyle}>
            <strong>{drawer === 'progress' ? '阶段时间线' : drawer === 'preview' ? '预览与产物' : drawer === 'assets' ? `${selectedScene?.id ?? '当前段'} 素材` : '运行日志'}</strong>
            <button type="button" style={drawerCloseStyle} onClick={() => setDrawer(null)}>关闭</button>
          </header>
          <div style={drawerBodyStyle}>
            {drawer === 'progress' ? (
              <div style={stageListStyle}>
                {stages.map((stage) => (
                  <div key={stage.id} style={stageItemStyle}>
                    <span style={stageDotStyle(stage.status)} />
                    <div>
                      <strong>{stage.label}</strong>
                      <p>{stage.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {drawer === 'preview' ? (
              <>
                <section style={scriptEditorStyle(scriptEditOpen)}>
                  <div style={scriptEditorHeaderStyle}>
                    <div>
                      <strong>文案修改</strong>
                      <p>修改文案后可强制重做语音、字幕和预览。</p>
                    </div>
                    <button type="button" style={drawerCloseStyle} onClick={() => setScriptEditOpen((open) => !open)}>
                      {scriptEditOpen ? '收起' : '修改文案'}
                    </button>
                  </div>
                  {scriptEditOpen ? (
                    <div style={scriptEditorBodyStyle}>
                      <textarea
                        value={scriptDraft}
                        onChange={(event) => setScriptDraft(event.target.value)}
                        style={scriptTextareaStyle}
                        disabled={generationBusy}
                      />
                      <div style={reviewActionsStyle}>
                        <button type="button" style={smallActionStyle(actionRunning === 'script-save')} disabled={generationBusy} onClick={() => saveScriptDraft({regenerate: false})}>
                          保存文案
                        </button>
                        <button type="button" style={smallActionStyle(actionRunning === 'script-regenerate')} disabled={generationBusy} onClick={() => saveScriptDraft({regenerate: true})}>
                          保存并重做语音+预览
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
                <PreviewDeck
                  scene={selectedScene}
                  fps={fps}
                  render={render}
                  cacheKey={cacheKey}
                  disabled={generationBusy}
                  onRenderPreview={(sceneId) => runAction({
                    id: `${sceneId}-manual-preview`,
                    type: 'render_preview_scene',
                    sceneId,
                    label: '渲染本段预览',
                    description: '手动触发预览渲染。',
                    tone: 'primary',
                  })}
                  onOpenTune={() => {
                    setDrawer(null);
                    setInput(selectedScene ? `请根据当前 ${selectedScene.id} 预览效果，帮我微调画面、字幕和节奏。` : '请帮我微调当前预览。');
                  }}
                />
                <div style={reviewActionsStyle}>
                  <button type="button" style={smallActionStyle(false)} onClick={acceptPreview}>通过</button>
                  <button type="button" style={smallActionStyle(false)} onClick={() => setScriptEditOpen(true)}>修改</button>
                  <button type="button" style={smallActionStyle(false)} disabled={generationBusy} onClick={regeneratePreview}>重新生成</button>
                </div>
              </>
            ) : null}
            {drawer === 'assets' ? (
              <SceneAssetsDrawer
                scene={selectedScene}
                drafts={selectedSceneDrafts}
                intentOptions={Object.entries(intentLabel) as [AgentAssetIntent, string][]}
                disabled={generationBusy}
                onUpdateIntent={updateAttachmentIntent}
                onUpdateNotes={updateAttachmentNotes}
                onRemoveDraft={(id) => setAttachments((current) => current.filter((asset) => asset.id !== id))}
                onInsertMention={appendMention}
              />
            ) : null}
            {drawer === 'logs' ? (
              <div style={logBoxStyle}>{logs.slice(-120).map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

const shellStyle: React.CSSProperties = {height: '100vh', overflow: 'hidden', background: '#111', color: '#f2f2f2', fontFamily: 'Inter, Segoe UI, Arial, sans-serif', position: 'relative'};
const topBarStyle: React.CSSProperties = {height: 38, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#b9b9b9', fontSize: 12};
const chatStageStyle: React.CSSProperties = {height: 'calc(100vh - 38px)', maxWidth: 980, margin: '0 auto', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto auto auto', gap: 12, padding: '18px 22px'};
const threadStyle: React.CSSProperties = {overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18, padding: '6px 0 18px'};
const messageStyle = (role: AgentMessage['role']): React.CSSProperties => ({display: 'grid', justifyItems: role === 'user' ? 'end' : 'start', gap: 6});
const messageLabelStyle: React.CSSProperties = {fontSize: 12, color: '#8c8c8c'};
const bubbleStyle = (role: AgentMessage['role']): React.CSSProperties => ({
  maxWidth: role === 'user' ? '78%' : '86%',
  whiteSpace: 'pre-wrap',
  color: '#ededed',
  background: role === 'user' ? '#2d2d2d' : 'transparent',
  border: role === 'user' ? '1px solid rgba(255,255,255,0.08)' : 'none',
  borderRadius: 14,
  padding: role === 'user' ? '12px 14px' : 0,
  lineHeight: 1.72,
  fontSize: 15,
});
const thinkingStyle: React.CSSProperties = {color: '#8c8c8c', fontSize: 13};
const reviewCardStyle: React.CSSProperties = {display: 'grid', gap: 10, border: '1px solid rgba(255,255,255,0.10)', background: '#1a1a1a', borderRadius: 14, padding: 12};
const actionPillRowStyle: React.CSSProperties = {display: 'flex', gap: 8, flexWrap: 'wrap'};
const smallActionStyle = (active: boolean): React.CSSProperties => ({border: '1px solid rgba(255,255,255,0.13)', background: active ? '#303030' : '#222', color: '#ededed', borderRadius: 999, padding: '8px 12px', cursor: active ? 'wait' : 'pointer', fontWeight: 700});
const drawerButtonRowStyle: React.CSSProperties = {display: 'flex', justifyContent: 'center', gap: 8};
const drawerButtonStyle = (active: boolean): React.CSSProperties => ({border: '1px solid rgba(255,255,255,0.10)', background: active ? '#303030' : '#1d1d1d', color: '#d6d6d6', borderRadius: 999, padding: '7px 11px', cursor: 'pointer'});
const composerShellStyle: React.CSSProperties = {border: '1px solid rgba(255,255,255,0.12)', background: '#2a2a2a', borderRadius: 22, padding: 10, boxShadow: '0 20px 80px rgba(0,0,0,0.35)'};
const modeRowStyle: React.CSSProperties = {display: 'flex', gap: 6, marginBottom: 8};
const modeButtonStyle = (active: boolean): React.CSSProperties => ({border: '1px solid rgba(255,255,255,0.10)', background: active ? '#404040' : '#242424', color: active ? '#fff' : '#bdbdbd', borderRadius: 999, padding: '6px 10px', cursor: 'pointer', fontSize: 12});
const inputStyle: React.CSSProperties = {width: '100%', minHeight: 92, boxSizing: 'border-box', resize: 'vertical', border: 0, outline: 'none', background: 'transparent', color: '#f2f2f2', padding: '6px 4px', lineHeight: 1.6, fontSize: 15};
const composerFooterStyle: React.CSSProperties = {display: 'flex', alignItems: 'center', gap: 10};
const fileButtonStyle: React.CSSProperties = {width: 30, height: 30, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#3b3b3b', color: '#ddd', cursor: 'pointer', fontSize: 22};
const modeHintStyle: React.CSSProperties = {flex: 1, color: '#a8a8a8', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'};
const sendButtonStyle = (disabled: boolean): React.CSSProperties => ({border: 0, background: disabled ? '#555' : '#f2f2f2', color: disabled ? '#aaa' : '#111', borderRadius: 999, padding: '9px 15px', fontWeight: 900, cursor: disabled ? 'not-allowed' : 'pointer'});
const drawerStyle: React.CSSProperties = {position: 'fixed', right: 18, top: 56, bottom: 18, width: 'min(560px, calc(100vw - 36px))', background: '#171717', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, boxShadow: '0 24px 90px rgba(0,0,0,0.55)', display: 'grid', gridTemplateRows: 'auto 1fr', zIndex: 10, overflow: 'hidden'};
const drawerHeaderStyle: React.CSSProperties = {display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)'};
const drawerCloseStyle: React.CSSProperties = {border: '1px solid rgba(255,255,255,0.12)', background: '#222', color: '#ddd', borderRadius: 8, padding: '6px 9px', cursor: 'pointer'};
const drawerBodyStyle: React.CSSProperties = {overflow: 'auto'};
const scriptEditorStyle = (open: boolean): React.CSSProperties => ({
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: open ? '#1f1f1f' : '#181818',
});
const scriptEditorHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'center',
  padding: 12,
};
const scriptEditorBodyStyle: React.CSSProperties = {display: 'grid', gap: 8, padding: '0 12px 12px'};
const scriptTextareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
  boxSizing: 'border-box',
  resize: 'vertical',
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#101010',
  color: '#f0f0f0',
  borderRadius: 10,
  padding: 10,
  lineHeight: 1.6,
  fontSize: 14,
};
const stageListStyle: React.CSSProperties = {display: 'grid', gap: 12, padding: 14};
const stageItemStyle: React.CSSProperties = {display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, alignItems: 'start'};
const stageDotStyle = (status: AgentStageStatus): React.CSSProperties => ({width: 10, height: 10, borderRadius: 999, marginTop: 5, background: stageColor[status], boxShadow: status === 'running' ? `0 0 14px ${stageColor[status]}` : 'none'});
const reviewActionsStyle: React.CSSProperties = {display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)'};
const logBoxStyle: React.CSSProperties = {padding: 14, whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace', fontSize: 12, color: '#bdbdbd', lineHeight: 1.6};
