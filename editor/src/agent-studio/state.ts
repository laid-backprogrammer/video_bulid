import type {AgentAction, CodegenStatus, PipelineStatus, RenderStatus, SceneItem, SceneReadiness, TtsStatus} from './types';

export const STUDIO_GOAL = '完成当前视频';

export const renderPhaseLabel: Record<string, string> = {
  starting: '准备中',
  preflight: '预检关键帧',
  bundling: '打包中',
  metadata: '读取合成信息',
  rendering: '渲染帧',
  encoding: '编码视频',
  done: '完成',
  failed: '失败',
};

export const formatDuration = (ms?: number | null) => {
  if (!ms) return '未生成';
  return `${(ms / 1000).toFixed(1)}s`;
};

export const isSceneBusy = (
  sceneId: string,
  tts: TtsStatus | null,
  codegen: CodegenStatus | null,
  render: RenderStatus | null,
  pipeline: PipelineStatus | null,
) => {
  if (tts?.running && (tts.mode === 'all' || tts.currentSceneId === sceneId || tts.sceneId === sceneId)) return true;
  if (codegen?.running && codegen.sceneId === sceneId) return true;
  if (render?.running && render.mode === 'scene' && render.sceneId === sceneId) return true;
  if (pipeline?.running && pipeline.scenes.some((item) => item.id === sceneId && item.status !== 'done')) return true;
  return false;
};

export const getSceneReadiness = (scene: SceneItem): SceneReadiness => {
  const blockers: string[] = [];
  let score = 0;
  const total = 6;

  if (scene.text.trim()) score += 1;
  else blockers.push('缺少文案');

  if (scene.audioExists) score += 1;
  else blockers.push('缺少语音');

  if (scene.captionExists) score += 1;
  else blockers.push('缺少字幕时间轴');

  if (scene.designNotes?.trim()) score += 1;
  else blockers.push('缺少视觉方案');

  if (scene.cues?.length) score += 1;
  else blockers.push('没有可用 cue');

  if (scene.enabled !== false) score += 1;
  else blockers.push('未加入成片');

  const readyForPreview = Boolean(scene.text.trim() && scene.audioExists && scene.captionExists && scene.cues?.length);
  const readyForRender = Boolean(scene.enabled !== false && readyForPreview);
  let nextAction = '检查预览并微调';

  if (!scene.text.trim()) nextAction = '补齐文案';
  else if (scene.enabled === false) nextAction = '确认是否加入成片';
  else if (!scene.audioExists) nextAction = '生成语音';
  else if (!scene.captionExists) nextAction = '对齐字幕时间轴';
  else if (!scene.designNotes?.trim()) nextAction = '生成视觉方案';
  else if (!scene.cues?.length) nextAction = '重建预览数据';
  else if (!scene.tuningNotes?.trim()) nextAction = '预览后按需微调';

  const label = readyForRender ? '可进入预览' : score >= 3 ? '制作中' : '待启动';

  return {
    sceneId: scene.id,
    score,
    total,
    label,
    nextAction,
    blockers,
    readyForPreview,
    readyForRender,
  };
};

export const getOverallReadiness = (scenes: SceneItem[]) => {
  const included = scenes.filter((scene) => scene.enabled !== false && scene.text.trim());
  const ready = included.filter((scene) => getSceneReadiness(scene).readyForRender);
  const previewable = scenes.filter((scene) => getSceneReadiness(scene).readyForPreview);
  return {
    totalScenes: scenes.length,
    includedScenes: included.length,
    readyScenes: ready.length,
    previewableScenes: previewable.length,
    percent: included.length ? Math.round((ready.length / included.length) * 100) : 0,
  };
};

export const getRunStateText = (
  tts: TtsStatus | null,
  codegen: CodegenStatus | null,
  render: RenderStatus | null,
  pipeline: PipelineStatus | null,
) => {
  if (tts?.running) return `语音生成中：${tts.currentSceneId ?? '全部'} · ${tts.message}`;
  if (codegen?.running) return `Remotion 代码生成中：${codegen.sceneId ?? ''} · ${codegen.message}`;
  if (render?.running) {
    const progress = render.progress;
    const phase = progress ? renderPhaseLabel[progress.phase] ?? progress.phase : '运行中';
    return `渲染中：${phase}${progress ? ` · ${progress.percent}%` : ''}`;
  }
  if (pipeline?.running) return '流水线运行中';
  return '空闲';
};

export const fallbackActionsForScene = (scene: SceneItem | null, render: RenderStatus | null): AgentAction[] => {
  if (!scene) return [];
  const actions: AgentAction[] = [];
  if (scene.text.trim() && !scene.audioExists) {
    actions.push({
      id: `${scene.id}-tts`,
      type: 'run_tts_scene',
      sceneId: scene.id,
      label: '生成本段语音',
      description: '调用现有 TTS 接口，为当前场景生成配音。',
      tone: 'primary',
    });
  }
  if (scene.audioExists && !scene.captionExists) {
    actions.push({
      id: `${scene.id}-asr`,
      type: 'run_asr_scene',
      sceneId: scene.id,
      label: '对齐字幕时间轴',
      description: '调用 ASR/时间轴对齐，生成 cues 和 words。',
      tone: 'primary',
    });
  }
  if (scene.captionExists && !scene.designNotes?.trim()) {
    actions.push({
      id: `${scene.id}-design`,
      type: 'generate_design_scene',
      sceneId: scene.id,
      label: '生成视觉方案',
      description: '让 LLM 根据文案、时间轴和素材产出画面 brief。',
      tone: 'primary',
    });
  }
  if (scene.captionExists) {
    actions.push({
      id: `${scene.id}-codegen`,
      type: 'generate_code_scene',
      sceneId: scene.id,
      label: '生成 Remotion 场景代码',
      description: '根据设计方案和字幕时间轴生成或更新本段 TSX。',
      tone: 'neutral',
    });
    actions.push({
      id: `${scene.id}-preview`,
      type: 'render_preview_scene',
      sceneId: scene.id,
      label: '渲染本段预览',
      description: '导出当前场景 MP4，便于检查微调效果。',
      tone: 'primary',
    });
  }
  actions.push({
    id: 'rebuild-manifest',
    type: 'rebuild_manifest',
    label: '重建预览数据',
    description: '刷新 manifest，让最新音频、字幕和素材进入预览。',
    tone: 'neutral',
  });
  if (!render?.running) {
    actions.push({
      id: 'render-full',
      type: 'render_full_video',
      label: '渲染完整视频',
      description: '将当前已启用且就绪的场景导出为完整视频。',
      tone: 'warn',
    });
  }
  return actions.slice(0, 4);
};

